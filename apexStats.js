const { EmbedBuilder } = require('discord.js')

const APEX_API_KEY = process.env.APEX_API_KEY
const APEX_API_BASE = 'https://api.mozambiquehe.re'

// ── Roast / compliment banks by placement tier ──────────────────────────────

const BOTTOM_10_ROASTS = [
  "bottom 10 placement. bro really queued up to lose faster.",
  "dropped hot, died cold. another game in the books.",
  "placement like that and still no rank anxiety, impressive honestly.",
  "ass placement, ass game, couldn't be me.",
]

const TOP_5_TO_10_COMPLIMENTS = [
  "not bad, decent placement ngl.",
  "top 10, respectable. keep climbing.",
  "solid game, nothing crazy but you didn't embarrass yourself.",
]

const TOP_2_TO_4_COMPLIMENTS = [
  "okay that's actually impressive, no cap.",
  "you're cooking fr, that placement goes hard.",
  "top 4?? okay I see you.",
]

const TOP_1_ROASTS = [
  "champion. in this economy? bro clearly has no life outside this game.",
  "W placement but also an L because of how many hours that took.",
  "certified no-lifer moment. congrats I guess.",
]

function getPlacementTier(place) {
  if (place === 1) return 'top1'
  if (place >= 2 && place <= 4) return 'top2to4'
  if (place >= 5 && place <= 10) return 'top5to10'
  return 'bottom10' // 11+
}

function getPlacementLine(place) {
  const tier = getPlacementTier(place)
  const bank = {
    top1: TOP_1_ROASTS,
    top2to4: TOP_2_TO_4_COMPLIMENTS,
    top5to10: TOP_5_TO_10_COMPLIMENTS,
    bottom10: BOTTOM_10_ROASTS,
  }[tier]
  return bank[Math.floor(Math.random() * bank.length)]
}

// ── Player linking ───────────────────────────────────────────────────────────

async function linkPlayer(supabase, discordId, originName, platform) {
  // Tell the Apex API to start tracking this player's match events
  const trackRes = await fetch(
    `${APEX_API_BASE}/bridge?auth=${APEX_API_KEY}&player=${encodeURIComponent(originName)}&platform=${platform}&history=1&action=add`
  )
  const trackData = await trackRes.json()

  await supabase.from('apex_players').upsert({
    discord_id: discordId,
    origin_name: originName,
    platform,
    apex_uid: trackData?.uid ?? null,
  })

  return trackData
}

async function getLinkedPlayer(supabase, discordId) {
  const { data } = await supabase.from('apex_players').select('*').eq('discord_id', discordId).single()
  return data
}

async function getLinkedPlayerByUid(supabase, uid) {
  const { data } = await supabase.from('apex_players').select('*').eq('apex_uid', uid).single()
  return data
}

// ── AI roast for kills / damage (separate from placement tier) ──────────────

async function getStatsRoast(geminiModel, { kills, assists, damage, place }) {
  const prompt = `Someone just finished an Apex Legends match. Placement: #${place}. Kills: ${kills}. Assists: ${assists}. Damage: ${damage}.

Write ONE short, savage or funny one-liner reacting specifically to their kills/damage numbers (not their placement, that's handled separately). Casual Taglish gaming trash-talk tone, like friends clowning each other in a Discord server. No slurs, no comments about anyone's sexuality, appearance, or personal life — keep it strictly about their in-game performance (damage numbers, kill count, fighting like a bot, etc). Max 1 sentence.`

  const result = await geminiModel.generateContent(prompt)
  return result.response.text().trim()
}

// ── Build and post the match summary embed ──────────────────────────────────

async function postMatchSummary(client, channelId, geminiModel, player, matchData) {
  const { place, kills, assists, damage } = matchData

  const placementLine = getPlacementLine(place)
  const statsLine = await getStatsRoast(geminiModel, { kills, assists, damage, place })

  const embed = new EmbedBuilder()
    .setTitle(`🎮 Apex Match — <@${player.discord_id}>`)
    .addFields(
      { name: '📍 Placement', value: `#${place}`, inline: true },
      { name: '💀 Kills', value: String(kills), inline: true },
      { name: '🤝 Assists', value: String(assists), inline: true },
      { name: '💥 Damage', value: String(damage), inline: true },
    )
    .setDescription(`${placementLine}\n\n${statsLine}`)
    .setColor(place === 1 ? 0xfbbf24 : place <= 4 ? 0x22c55e : place <= 10 ? 0x3b82f6 : 0xef4444)
    .setTimestamp()

  const channel = await client.channels.fetch(channelId)
  if (channel) await channel.send({ embeds: [embed] })
}

module.exports = {
  linkPlayer,
  getLinkedPlayer,
  getLinkedPlayerByUid,
  postMatchSummary,
  getPlacementTier,
}
