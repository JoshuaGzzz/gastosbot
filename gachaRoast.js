// ── Gacha Addict Roaster ────────────────────────────────────────────────────
// Targets user 750962212566204457 specifically.
// Roasts him individually per gacha, and delivers a MEGA ROAST when he
// opens all 4 in a single day.

const { EmbedBuilder } = require('discord.js')

const GACHA_VICTIM_ID = '750962212566204457'

// Map of Discord activity names → internal gacha keys
const GACHA_GAMES = {
  'Genshin Impact': {
    key: 'genshin',
    emoji: '🌬️',
    color: 0x6cb4ee,
    nickname: 'Genshin',
  },
  'Zenless Zone Zero': {
    key: 'zzz',
    emoji: '📺',
    color: 0xf5c542,
    nickname: 'ZZZ',
  },
  'Wuthering Waves': {
    key: 'wuwa',
    emoji: '🌊',
    color: 0x5eead4,
    nickname: 'Wuwa',
  },
  'Honkai: Star Rail': {
    key: 'hsr',
    emoji: '🚂',
    color: 0xc084fc,
    nickname: 'HSR',
  },
}

// All activity name variants we should detect
const ALL_GACHA_NAMES = Object.keys(GACHA_GAMES)

// ── Daily tracker ──────────────────────────────────────────────────────────
// Tracks which gachas the victim has opened today.
// Resets at midnight (server time).

let dailyGachas = new Set()   // set of gacha keys opened today
let lastResetDate = ''        // 'YYYY-MM-DD' string of last reset

function getTodayStr() {
  // Use PH timezone (UTC+8)
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
}

function resetIfNewDay() {
  const today = getTodayStr()
  if (today !== lastResetDate) {
    dailyGachas = new Set()
    lastResetDate = today
  }
}

function markGachaPlayed(gachaKey) {
  resetIfNewDay()
  dailyGachas.add(gachaKey)
}

function hasPlayedAllFour() {
  resetIfNewDay()
  return dailyGachas.size >= 4
}

function getPlayedToday() {
  resetIfNewDay()
  return new Set(dailyGachas)
}

// ── Cooldown to prevent spam ───────────────────────────────────────────────
// One roast per game per 2-hour window so we don't spam if he relaunches

const roastCooldowns = new Map() // key: gachaKey, value: timestamp
const COOLDOWN_MS = 2 * 60 * 60 * 1000 // 2 hours

let megaRoastFired = '' // date string of last mega roast

function isOnCooldown(gachaKey) {
  const last = roastCooldowns.get(gachaKey)
  if (!last) return false
  return (Date.now() - last) < COOLDOWN_MS
}

function setCooldown(gachaKey) {
  roastCooldowns.set(gachaKey, Date.now())
}

// ── AI Roast Generators ────────────────────────────────────────────────────

async function generateIndividualRoast(geminiModel, gachaInfo, memberDisplayName) {
  const prompt = `You are a savage Discord roast bot in a Filipino friend group server. Your target is "${memberDisplayName}" who just opened ${gachaInfo.nickname} (${getFullGameDescription(gachaInfo.key)}).

Generate a SHORT, BRUTAL, FUNNY roast (2-3 sentences max) about them opening this specific gacha game. 

Game-specific angles to roast:
${getGameSpecificAngles(gachaInfo.key)}

Rules:
- Write in Taglish (mix of Tagalog and English), since that's how the friend group talks
- Be savage but in a funny "friend group" way, not actually mean
- Reference the specific game mechanics, characters, gacha system, or community memes
- Mock their gacha addiction, wasted money, copium, etc.
- Keep it to 2-3 sentences MAX
- Do NOT use quotation marks around the roast
- Do NOT add any prefix or label, just the roast itself`

  try {
    const result = await geminiModel.generateContent(prompt)
    return result.response.text().trim()
  } catch (err) {
    console.error(`[gacha-roast] Gemini error for ${gachaInfo.key}:`, err.message)
    return getFallbackRoast(gachaInfo.key, memberDisplayName)
  }
}

async function generateMegaRoast(geminiModel, memberDisplayName) {
  const prompt = `You are a savage Discord roast bot in a Filipino friend group server. Your target is "${memberDisplayName}" — and this absolute GACHA ADDICT has opened ALL FOUR of these gacha games in a SINGLE DAY:

1. Genshin Impact
2. Zenless Zone Zero (ZZZ)
3. Wuthering Waves (Wuwa)
4. Honkai: Star Rail (HSR)

This is the MEGA ROAST. The ultimate callout. He literally spent his entire day cycling through gacha games. Generate an ABSOLUTELY DEVASTATING roast (4-6 sentences) about this degenerate behavior.

Angles to hit:
- He played ALL FOUR Hoyo games + Wuwa in ONE day
- His daily routine is literally just gacha → gacha → gacha → gacha
- Wallet destruction across 4 different games
- Touch grass references
- The sheer dedication to fictional anime characters over real life
- He's basically funding miHoYo/Kuro Games' entire revenue
- Zero productivity energy

Rules:
- Write in Taglish (mix of Tagalog and English)
- Be absolutely RUTHLESS but funny — this is the big one
- Reference specific things from each game if possible
- 4-6 sentences, make every word count
- Do NOT use quotation marks
- Do NOT add any prefix or label`

  try {
    const result = await geminiModel.generateContent(prompt)
    return result.response.text().trim()
  } catch (err) {
    console.error('[gacha-roast] Gemini mega roast error:', err.message)
    return `${memberDisplayName} just opened ALL FOUR gacha games in one day. Genshin, ZZZ, Wuwa, AND HSR. Bro literally has a rotation schedule para sa gacha games niya. Hindi ka nag-aral, hindi ka nag-work, puro resin, battery, waveplates, at trailblaze power lang iniisip mo. Gacha speedrun any% world record holder ka na.`
  }
}

// ── Game-specific flavor text ──────────────────────────────────────────────

function getFullGameDescription(key) {
  const descriptions = {
    genshin: 'a gacha RPG by miHoYo/HoYoverse — resin system, artifact grinding, losing 50/50s',
    zzz: 'a gacha action game by miHoYo/HoYoverse — battery charges, bangboo collecting, proxy work',
    wuwa: 'a gacha RPG by Kuro Games — waveplates, echo farming, convene pulls',
    hsr: 'a gacha turn-based RPG by miHoYo/HoYoverse — trailblaze power, relic grinding, warp pulls',
  }
  return descriptions[key] || 'a gacha game'
}

function getGameSpecificAngles(key) {
  const angles = {
    genshin: `- Resin addiction, always waiting for resin to refill
- Losing 50/50 to Qiqi or Dehya
- Artifact farming hell (never getting the right substats)
- "Just one more pull" copium
- F2P BTW mentality but secretly swiping
- Emergency food (Paimon)`,

    zzz: `- Battery charge system, always out of battery
- Collecting bangboos like Pokemon
- The TV/proxy aesthetic being his whole personality
- Inter-Knot browsing addiction
- Belle/Wise proxy life vs his actual life
- Spending on every limited banner`,

    wuwa: `- Waveplates always empty
- Echo farming RNG hell
- Convene system copium
- "Wuwa is better than Genshin" copium
- Rover being a blank slate just like his personality
- Switching from Genshin to Wuwa but still playing both`,

    hsr: `- Trailblaze power always at zero
- Relic farming (same pain as artifacts but on a train)
- Warp addiction, always checking pity count
- Simping for characters (Kafka, Firefly, etc.)
- "Strategic turn-based gameplay" but he just auto-battles
- March 7th collecting cameras while he collects L's`,
  }
  return angles[key] || '- Generic gacha addiction'
}

function getFallbackRoast(key, name) {
  const fallbacks = {
    genshin: `${name} nag-open na naman ng Genshin. Tara na daw, may resin na siya. Bro your resin refreshes faster than your will to live. 💀`,
    zzz: `${name} bukas na naman ang ZZZ. Battery charged, social life — not so much. Proxy ka lang sa game, proxy ka rin sa real life eh. 📺`,
    wuwa: `${name} is back on Wuwa. Waveplates full, wallet empty. Kuro Games employee of the month na naman siya. 🌊`,
    hsr: `${name} sumakay na naman sa Astral Express. Trailblaze power: recharged. Bank account: derailed. Bro you're not blazing trails, you're blazing through your savings. 🚂`,
  }
  return fallbacks[key] || `${name} opened another gacha game. Least addicted gacha player. 💀`
}

// ── Main handler ───────────────────────────────────────────────────────────

/**
 * Call this from the presenceUpdate handler.
 * Returns true if this event was handled (victim + gacha game detected).
 */
async function handleGachaPresence(oldPresence, newPresence, client, geminiModel, channelId) {
  // Only target the victim
  if (newPresence.userId !== GACHA_VICTIM_ID) return false

  // Check each gacha game
  for (const [activityName, gachaInfo] of Object.entries(GACHA_GAMES)) {
    const wasPlaying = oldPresence?.activities?.some(a => a.name === activityName)
    const isPlaying = newPresence?.activities?.some(a => a.name === activityName)

    if (!wasPlaying && isPlaying) {
      // Skip if on cooldown
      if (isOnCooldown(gachaInfo.key)) {
        console.log(`[gacha-roast] ${gachaInfo.key} on cooldown, skipping`)
        return true // still "handled" — just silently
      }

      setCooldown(gachaInfo.key)
      markGachaPlayed(gachaInfo.key)

      const memberName = newPresence.member?.displayName || 'Gacha Addict'

      try {
        const channel = await client.channels.fetch(channelId)
        if (!channel) return true

        // ── Individual game roast ──────────────────────────────────
        const roastText = await generateIndividualRoast(geminiModel, gachaInfo, memberName)

        const embed = new EmbedBuilder()
          .setTitle(`${gachaInfo.emoji} ${gachaInfo.nickname} Addict Detected`)
          .setDescription(roastText)
          .setColor(gachaInfo.color)
          .setFooter({ text: `🎰 Gacha #${dailyGachas.size}/4 today` })
          .setTimestamp()

        await channel.send({
          content: `${newPresence.member}`,
          embeds: [embed],
          allowedMentions: { parse: ['users'] },
        })

        // ── Check for MEGA ROAST (all 4 in one day) ────────────────
        const today = getTodayStr()
        if (hasPlayedAllFour() && megaRoastFired !== today) {
          megaRoastFired = today

          // Small delay so the individual roast lands first
          await new Promise(r => setTimeout(r, 3000))

          const megaText = await generateMegaRoast(geminiModel, memberName)

          const megaEmbed = new EmbedBuilder()
            .setTitle('🚨🎰 GACHA GRAND SLAM DETECTED 🎰🚨')
            .setDescription(megaText)
            .addFields(
              { name: '🌬️ Genshin Impact', value: '✅ Played', inline: true },
              { name: '📺 Zenless Zone Zero', value: '✅ Played', inline: true },
              { name: '🌊 Wuthering Waves', value: '✅ Played', inline: true },
              { name: '🚂 Honkai: Star Rail', value: '✅ Played', inline: true },
            )
            .setColor(0xff0000)
            .setFooter({ text: '4/4 GACHA GAMES IN ONE DAY — SEEK HELP 💀' })
            .setTimestamp()

          await channel.send({
            content: `${newPresence.member} ☠️ **ALL FOUR GACHAS IN ONE DAY** ☠️`,
            embeds: [megaEmbed],
            allowedMentions: { parse: ['users'] },
          })
        }

      } catch (err) {
        console.error(`[gacha-roast] error for ${gachaInfo.key}:`, err.message)
      }

      return true
    }
  }

  return false
}

/**
 * Check if an activity name is one of the tracked gacha games.
 */
function isGachaGame(activityName) {
  return activityName in GACHA_GAMES
}

module.exports = {
  handleGachaPresence,
  isGachaGame,
  GACHA_VICTIM_ID,
  GACHA_GAMES,
}
