const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js')

const BETTING_DURATION_MS = 30_000
const activeSabongGames = new Map()

const FIGHT_FRAMES = [
  {
    title: '🐓 LASLAS NA! FIGHT BEGINS!',
    scene: [
      '```',
      '🔴 MERON          WALA 🔵',
      '',
      '   >🐓            🐓<   ',
      '                        ',
      '     . . . circling . . .',
      '```',
    ].join('\n'),
  },
  {
    title: '💨 THEY CHARGE!',
    scene: [
      '```',
      '🔴 MERON          WALA 🔵',
      '',
      '      >🐓      🐓<      ',
      '      ~~~~~~~~          ',
      '       charging!!!      ',
      '```',
    ].join('\n'),
  },
  {
    title: '💥 CLASH!',
    scene: [
      '```',
      '🔴 MERON          WALA 🔵',
      '',
      '         >🐓🐓<          ',
      '           💥            ',
      '        LASLAS!!!        ',
      '```',
    ].join('\n'),
  },
  {
    title: '🩸 ROUND 2!',
    scene: [
      '```',
      '🔴 MERON          WALA 🔵',
      '',
      '   >🐓            🐓<   ',
      '   ~~~            ~~~   ',
      '    both still alive!   ',
      '```',
    ].join('\n'),
  },
  {
    title: '😤 THEY GO AGAIN!',
    scene: [
      '```',
      '🔴 MERON          WALA 🔵',
      '',
      '        >🐓  🐓<         ',
      '        CLASH!!          ',
      '        💥💥💥           ',
      '```',
    ].join('\n'),
  },
  {
    title: '⚔️ FINAL BLOW!',
    scene: [
      '```',
      '🔴 MERON          WALA 🔵',
      '',
      '         >🐓🐓<          ',
      '           💥            ',
      '      DECIDING BLOW!!!   ',
      '```',
    ].join('\n'),
  },
]

function buildWinnerFrame(winner, losers, winnerBettors, loserBettors) {
  const winnerLabel = winner === 'meron' ? '🔴 MERON' : '🔵 WALA'
  const loserLabel = winner === 'meron' ? 'WALA 🔵' : 'MERON 🔴'

  const scene = winner === 'meron'
    ? [
        '```',
        `🔴 MERON          WALA 🔵`,
        '',
        `   >🐓🏆          💀    `,
        `   WINNER!        ded   `,
        '```',
      ].join('\n')
    : [
        '```',
        `🔴 MERON          WALA 🔵`,
        '',
        `     💀          🏆🐓<  `,
        `     ded         WINNER!`,
        '```',
      ].join('\n')

  return {
    title: `${winnerLabel} WINS! GAME!`,
    scene,
    winnerLabel,
    loserLabel,
    winnerBettors,
    loserBettors,
  }
}

async function animateFight(interaction, game) {
  const winner = Math.random() < 0.5 ? 'meron' : 'wala'
  const loser = winner === 'meron' ? 'wala' : 'meron'
  const winnerBettors = game.bets[winner]
  const loserBettors = game.bets[loser]

  for (const frame of FIGHT_FRAMES) {
    const embed = new EmbedBuilder()
      .setTitle(frame.title)
      .setDescription(frame.scene)
      .setColor(0xfbbf24)

    await interaction.editReply({ embeds: [embed], components: [] })
    await new Promise(resolve => setTimeout(resolve, 1500))
  }

  const result = buildWinnerFrame(winner, loser, winnerBettors, loserBettors)

  const embed = new EmbedBuilder()
    .setTitle(`🏆 ${result.title}`)
    .setDescription(result.scene)
    .addFields(
      {
        name: `✅ ${result.winnerLabel} — ${result.winnerBettors.length} bettor(s)`,
        value: result.winnerBettors.length ? result.winnerBettors.map(id => `<@${id}>`).join(', ') : 'Nobody bet on this side lmao',
        inline: true,
      },
      {
        name: `💀 ${result.loserLabel} — ${result.loserBettors.length} bettor(s)`,
        value: result.loserBettors.length ? result.loserBettors.map(id => `<@${id}>`).join(', ') : 'Nobody',
        inline: true,
      },
    )
    .setColor(winner === 'meron' ? 0xef4444 : 0x3b82f6)
    .setTimestamp()

  await interaction.editReply({ embeds: [embed], components: [] })
}

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
      .setDescription('```\n   >🐓            🐓<   \n\n    Handlers releasing...\n```')
      .setColor(0xf97316)

    await interaction.editReply({ embeds: [closedEmbed], components: [buildRow(true)] })
    await new Promise(resolve => setTimeout(resolve, 2000))
    await animateFight(interaction, gameState)
  }, BETTING_DURATION_MS)
}

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

function buildBettingEmbed(game) {
  return new EmbedBuilder()
    .setTitle('🐓 SABONG — Meron o Wala?')
    .setDescription(
      '```\n🔴 MERON          WALA 🔵\n\n   >🐓            🐓<   \n\n  Place your bets now!!!\n```\n' +
      `Betting closes <t:${Math.floor(game.endTime / 1000)}:R>`
    )
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
    .setFooter({ text: 'You can switch sides until betting closes.' })
}

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
