const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js')

const BETTING_DURATION_MS = 30_000
const activeSabongGames = new Map() // channelId -> game state

async function startSabong(interaction) {
  if (activeSabongGames.has(interaction.channelId)) {
    return interaction.reply({ content: '⚠️ Sabong already running in this channel!', ephemeral: true })
  }

  const endTime = Date.now() + BETTING_DURATION_MS
  const gameState = { bets: { meron: [], wala: [] }, closed: false, endTime }
  activeSabongGames.set(interaction.channelId, gameState)

  const reply = await interaction.reply({
    embeds: [buildBettingEmbed(gameState)],
    components: [buildRow(false)],
    fetchReply: true,
  })

  gameState.interaction = interaction

  setTimeout(async () => {
    await closeSabong(gameState)
    activeSabongGames.delete(interaction.channelId)
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

async function closeSabong(game) {
  game.closed = true

  const winner = Math.random() < 0.5 ? 'meron' : 'wala'
  const loser = winner === 'meron' ? 'wala' : 'meron'
  const winners = game.bets[winner]
  const losers = game.bets[loser]

  const winnerLabel = winner === 'meron' ? '🔴 Meron' : '🔵 Wala'
  const loserLabel = loser === 'meron' ? '🔴 Meron' : '🔵 Wala'

  const embed = new EmbedBuilder()
    .setTitle(`🐓 ${winnerLabel.toUpperCase()} WINS! LASLAS!`)
    .addFields(
      {
        name: `🏆 ${winnerLabel} (${winners.length})`,
        value: winners.length ? winners.map(id => `<@${id}>`).join(', ') : 'Nobody',
        inline: true,
      },
      {
        name: `💀 ${loserLabel} (${losers.length})`,
        value: losers.length ? losers.map(id => `<@${id}>`).join(', ') : 'Nobody',
        inline: true,
      },
    )
    .setColor(winner === 'meron' ? 0xef4444 : 0x3b82f6)
    .setTimestamp()

  await game.interaction.editReply({ embeds: [embed], components: [buildRow(true)] })
}

function buildBettingEmbed(game) {
  return new EmbedBuilder()
    .setTitle('🐓 SABONG — Place your bets!')
    .setDescription(`Betting closes <t:${Math.floor(game.endTime / 1000)}:R>`)
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
