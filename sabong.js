const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js')

const BETTING_DURATION_MS = 15_000
const activeSabongGames = new Map()

// ── Hardcoded Tenor GIF URLs for each fight phase ──────────────────────────

const GIFS = {
  idle: [
    'https://media.tenor.com/kcrjrm59y7oAAAAd/gallos.gif',
    'https://media.tenor.com/ES0NXtRXBNcAAAAd/you-lookin-at-me-rooster.gif',
    'https://media.tenor.com/-zb6aLr7VEUAAAAd/%D0%BF%D0%B5%D1%82%D1%83%D1%85-rooster.gif',
  ],
  circling: [
    'https://media.tenor.com/HF6LiYhFV2kAAAAd/cock-fight-namma-veettu-pillai.gif',
    'https://media.tenor.com/XG6kqhrI0dYAAAAd/war-chicken.gif',
    'https://media.tenor.com/wrCreAPXR9gAAAAd/fighting-chickens-chicken.gif',
  ],
  charging: [
    'https://media.tenor.com/3VhgcVzmmrIAAAAd/on-my-way-keiji.gif',
    'https://media.tenor.com/97vgNyUw7coAAAAd/peter-griffin-peter-vs-chicken.gif',
    'https://media.tenor.com/n7UAaQsJq0kAAAAd/popodak-rooster.gif',
  ],
  laslas: [
    'https://media.tenor.com/E9Yk5IPqHkwAAAAd/chicken-bro-chicken.gif',
    'https://media.tenor.com/MXYhadhBH2UAAAAd/peter-griffin-peter.gif',
    'https://media.tenor.com/mqXl3_KpWlcAAAAd/chittimallu-exist-sankranthi.gif',
    'https://media.tenor.com/h7RT1UqCxsAAAAAd/chicken-bro-slap.gif',
  ],
  decidingBlow: [
    'https://media.tenor.com/uM_cnbdVCJgAAAAd/peter-griffin-peter-vs-chicken.gif',
    'https://media.tenor.com/Z0laAsKyrj8AAAAd/rooster-fighter-keiji.gif',
    'https://media.tenor.com/xwXbqNxPIvsAAAAd/kungfu-fight.gif',
  ],
  defeat: [
    'https://media.tenor.com/4YICm-LkkDEAAAAd/chicken-scared.gif',
    'https://media.tenor.com/o38i203tM-sAAAAd/peter-griffin-peter.gif',
  ],
  victory: [
    'https://media.tenor.com/t3-1V_5vCQQAAAAd/insane-rooster.gif',
    'https://media.tenor.com/pblJgyOT7BkAAAAd/natty-rooster.gif',
  ],
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ── Fight animation with GIFs and random round count ────────────────────────

async function animateFight(interaction, game) {
  const winner = Math.random() < 0.5 ? 'meron' : 'wala'
  const loser = winner === 'meron' ? 'wala' : 'meron'
  const winnerBettors = game.bets[winner]
  const loserBettors = game.bets[loser]

  // Random number of rounds before deciding blow (1 to 10)
  const totalRounds = Math.floor(Math.random() * 10) + 1

  // ── Phase 1: Circling ──
  const circlingEmbed = new EmbedBuilder()
    .setTitle('🐓 LASLAS NA! Circling...')
    .setDescription('The roosters size each other up in the arena...')
    .setImage(pickRandom(GIFS.circling))
    .setColor(0xfbbf24)

  await interaction.editReply({ embeds: [circlingEmbed], components: [] })
  await new Promise(resolve => setTimeout(resolve, 2500))

  // ── Phase 2: Charging ──
  const chargingEmbed = new EmbedBuilder()
    .setTitle('💨 SUMALAKAY! They charge!')
    .setDescription('Both roosters rush forward with talons out!')
    .setImage(pickRandom(GIFS.charging))
    .setColor(0xf97316)

  await interaction.editReply({ embeds: [chargingEmbed], components: [] })
  await new Promise(resolve => setTimeout(resolve, 2500))

  // ── Phase 3: Laslas/Clash rounds (random count) ──
  for (let round = 1; round <= totalRounds; round++) {
    const roundTitles = [
      `💥 ROUND ${round} — LASLAS!`,
      `⚔️ ROUND ${round} — CLASH!`,
      `🩸 ROUND ${round} — SALPUKAN!`,
    ]
    const roundDescriptions = [
      'Feathers fly as the blades clash!',
      'Both roosters exchange devastating blows!',
      'A fierce exchange — neither backing down!',
      'Talons spark as they collide mid-air!',
      'Blood and feathers everywhere! LASLAS!',
    ]

    const laslasEmbed = new EmbedBuilder()
      .setTitle(pickRandom(roundTitles))
      .setDescription(pickRandom(roundDescriptions))
      .setImage(pickRandom(GIFS.laslas))
      .setColor(0xef4444)
      .setFooter({ text: `Round ${round} of ${totalRounds}` })

    await interaction.editReply({ embeds: [laslasEmbed], components: [] })
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  // ── Phase 4: Deciding blow ──
  const decidingEmbed = new EmbedBuilder()
    .setTitle('⚡ DECIDING BLOW!!!')
    .setDescription('One final devastating strike... who will fall?!')
    .setImage(pickRandom(GIFS.decidingBlow))
    .setColor(0x7c3aed)

  await interaction.editReply({ embeds: [decidingEmbed], components: [] })
  await new Promise(resolve => setTimeout(resolve, 3000))

  // ── Phase 5: Result — Victory & Defeat ──
  const winnerLabel = winner === 'meron' ? '🔴 MERON' : '🔵 WALA'
  const loserLabel = winner === 'meron' ? 'WALA 🔵' : 'MERON 🔴'

  const resultEmbed = new EmbedBuilder()
    .setTitle(`🏆 ${winnerLabel} WINS! GAME!`)
    .setDescription(`The ${winner === 'meron' ? 'Meron' : 'Wala'} rooster delivers the killing blow after **${totalRounds} round(s)**!`)
    .setImage(pickRandom(GIFS.victory))
    .setThumbnail(pickRandom(GIFS.defeat))
    .addFields(
      {
        name: `✅ ${winnerLabel} — ${winnerBettors.length} bettor(s)`,
        value: winnerBettors.length ? winnerBettors.map(id => `<@${id}>`).join(', ') : 'Nobody bet on this side lmao',
        inline: true,
      },
      {
        name: `💀 ${loserLabel} — ${loserBettors.length} bettor(s)`,
        value: loserBettors.length ? loserBettors.map(id => `<@${id}>`).join(', ') : 'Nobody',
        inline: true,
      },
    )
    .setColor(winner === 'meron' ? 0xef4444 : 0x3b82f6)
    .setTimestamp()

  await interaction.editReply({ embeds: [resultEmbed], components: [] })
}

// ── Start sabong (betting phase with idle GIF) ──────────────────────────────

async function startSabong(interaction) {
  if (activeSabongGames.has(interaction.channelId)) {
    return interaction.reply({ content: '⚠️ Sabong already running in this channel!', ephemeral: true })
  }

  const endTime = Date.now() + BETTING_DURATION_MS
  const gameState = { bets: { meron: [], wala: [] }, closed: false, endTime, interaction }
  activeSabongGames.set(interaction.channelId, gameState)

  await interaction.reply({
    embeds: [buildBettingEmbed(gameState)],
    components: [buildRow(false)],
    fetchReply: true,
  })

  setTimeout(async () => {
    gameState.closed = true
    activeSabongGames.delete(interaction.channelId)

    const closedEmbed = new EmbedBuilder()
      .setTitle('🔒 BETTING CLOSED! Placing the birds in the ring...')
      .setDescription('The handlers release the roosters into the arena...')
      .setImage(pickRandom(GIFS.idle))
      .setColor(0xf97316)

    await interaction.editReply({ embeds: [closedEmbed], components: [buildRow(true)] })
    await new Promise(resolve => setTimeout(resolve, 2500))
    await animateFight(interaction, gameState)
  }, BETTING_DURATION_MS)
}

// ── Button handler ──────────────────────────────────────────────────────────

async function handleSabongButton(interaction) {
  const game = activeSabongGames.get(interaction.channelId)
  if (!game || game.closed) {
    return interaction.reply({ content: 'Betting is already closed.', ephemeral: true })
  }

  const side = interaction.customId === 'sabong_meron' ? 'meron' : 'wala'
  const userId = interaction.user.id

  game.bets.meron = game.bets.meron.filter(id => id !== userId)
  game.bets.wala = game.bets.wala.filter(id => id !== userId)
  game.bets[side].push(userId)

  await interaction.update({ embeds: [buildBettingEmbed(game)], components: [buildRow(false)] })
}

// ── Betting embed with idle GIF ─────────────────────────────────────────────

function buildBettingEmbed(game) {
  return new EmbedBuilder()
    .setTitle('🐓 SABONG — Meron o Wala?')
    .setDescription(
      `**Place your bets!** Betting closes <t:${Math.floor(game.endTime / 1000)}:R>\n\n` +
      '🔴 **MERON** vs **WALA** 🔵\n\n' +
      'Pick your rooster below!'
    )
    .setImage(pickRandom(GIFS.idle))
    .addFields(
      {
        name: `🔴 Meron (${game.bets.meron.length})`,
        value: game.bets.meron.length ? game.bets.meron.map(id => `<@${id}>`).join(', ') : 'No bets yet',
        inline: true,
      },
      {
        name: `🔵 Wala (${game.bets.wala.length})`,
        value: game.bets.wala.length ? game.bets.wala.map(id => `<@${id}>`).join(', ') : 'No bets yet',
        inline: true,
      },
    )
    .setColor(0xfbbf24)
    .setFooter({ text: 'You can switch sides until betting closes. 15 seconds!' })
}

// ── Button row ──────────────────────────────────────────────────────────────

function buildRow(disabled) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sabong_meron').setLabel('🔴 Meron').setStyle(ButtonStyle.Danger).setDisabled(disabled),
    new ButtonBuilder().setCustomId('sabong_wala').setLabel('🔵 Wala').setStyle(ButtonStyle.Primary).setDisabled(disabled),
  )
}

function isSabongButton(customId) {
  return customId === 'sabong_meron' || customId === 'sabong_wala'
}

module.exports = { startSabong, handleSabongButton, isSabongButton }
