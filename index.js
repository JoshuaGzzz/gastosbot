const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js')
const { createClient } = require('@supabase/supabase-js')
const express = require('express')

const BOT_TOKEN = process.env.BOT_TOKEN
const CLIENT_ID = process.env.CLIENT_ID
const GUILD_ID = process.env.GUILD_ID
const CHANNEL_ID = process.env.CHANNEL_ID
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_KEY
const WEBHOOK_PORT = process.env.WEBHOOK_PORT || 3000

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const KPOP_CATEGORIES = [
  'Albums',
  'Merch',
  'Concerts / Events',
  'Photocards',
  'Lightsticks',
  'Weverse / Digital',
  'Custom',
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatStreakDuration(ms) {
  const totalDays = Math.floor(ms / (1000 * 60 * 60 * 24))
  const months = Math.floor(totalDays / 30)
  const weeks = Math.floor((totalDays % 30) / 7)
  const days = totalDays % 7
  const parts = []
  if (months > 0) parts.push(`${months}mo`)
  if (weeks > 0) parts.push(`${weeks}w`)
  if (days > 0) parts.push(`${days}d`)
  if (parts.length === 0) parts.push('< 1d')
  return parts.join(' ')
}

function formatElapsed(ms) {
  const totalSeconds = Math.floor(ms / 1000)
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const totalHours = Math.floor(totalMinutes / 60)
  const hours = totalHours % 24
  const totalDays = Math.floor(totalHours / 24)
  const days = totalDays % 7
  const weeks = Math.floor(totalDays / 7) % 4
  const months = Math.floor(totalDays / 30)
  const pad = n => String(n).padStart(2, '0')
  return `${pad(months)}mo : ${pad(weeks)}w : ${pad(days)}d : ${pad(hours)}h : ${pad(minutes)}m : ${pad(seconds)}s`
}

function getLongestStreak(records, currentStartTime) {
  const currentMs = Date.now() - currentStartTime
  const pastStreaks = records
    .filter(r => r.prev_start_time != null)
    .map(r => new Date(r.timestamp).getTime() - r.prev_start_time)
    .filter(ms => ms > 0)
  return Math.max(...[...pastStreaks, currentMs])
}

// ── Register slash commands ───────────────────────────────────────────────────

const commands = [
  new SlashCommandBuilder()
    .setName('timer')
    .setDescription("Check Joseph's current no-spend streak"),

  new SlashCommandBuilder()
    .setName('reset')
    .setDescription("Reset Joseph's timer (he spent money)")
    .addStringOption(opt =>
      opt.setName('category')
        .setDescription('What did he spend on?')
        .setRequired(true)
        .addChoices(
          ...KPOP_CATEGORIES.filter(c => c !== 'Custom').map(c => ({ name: c, value: c })),
          { name: 'Custom', value: 'Custom' }
        )
    )
    .addStringOption(opt =>
      opt.setName('reason')
        .setDescription('Why did Joseph spend money?')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('custom_category')
        .setDescription('If category is Custom, type it here')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('bet')
    .setDescription('Place a bet on when Joseph will break next')
    .addStringOption(opt =>
      opt.setName('name')
        .setDescription('Your name')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('date')
        .setDescription('Your predicted date (YYYY-MM-DD)')
        .setRequired(true)
    )
    .addNumberOption(opt =>
      opt.setName('amount')
        .setDescription('How much are you betting? (₱)')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('discord_tag')
        .setDescription('Your Discord tag (optional)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('bets')
    .setDescription('Show the current betting leaderboard'),

  new SlashCommandBuilder()
    .setName('scream')
    .setDescription('Manually announce the latest reset from the website'),

].map(c => c.toJSON())

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN)
  try {
    console.log('Registering slash commands...')
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands })
    console.log('Slash commands registered.')
  } catch (err) {
    console.error('Failed to register commands:', err)
  }
}

// ── Bot ───────────────────────────────────────────────────────────────────────

const client = new Client({ intents: [GatewayIntentBits.Guilds] })

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`)
  await registerCommands()
})

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return

  // ── /timer ──────────────────────────────────────────────────────────────────
  if (interaction.commandName === 'timer') {
    await interaction.deferReply()
    const { data: timerData } = await supabase.from('timer_state').select('start_time').eq('id', 1).single()
    const { data: records } = await supabase.from('spending_records').select('*').order('created_at', { ascending: false })

    if (!timerData) return interaction.editReply('Could not fetch timer data.')

    const elapsed = Date.now() - timerData.start_time
    const longestMs = records?.length ? getLongestStreak(records, timerData.start_time) : elapsed
    const isRecord = elapsed >= longestMs

    const embed = new EmbedBuilder()
      .setTitle('Joseph Gastos Tracker')
      .setDescription('Joseph has not spent money since:')
      .addFields(
        { name: '⏱ Current Streak', value: `\`${formatElapsed(elapsed)}\``, inline: false },
        { name: '🏆 Longest Streak', value: formatStreakDuration(longestMs), inline: true },
        { name: '💀 Total Resets', value: String(records?.length ?? 0), inline: true },
      )
      .setColor(isRecord ? 0x22c55e : 0xffffff)
      .setFooter({ text: isRecord ? '🏆 Current streak is the best ever!' : 'ACCOUNTABILITY IS FOREVER' })
      .setTimestamp()

    await interaction.editReply({ embeds: [embed] })
  }

  // ── /reset ──────────────────────────────────────────────────────────────────
  if (interaction.commandName === 'reset') {
    await interaction.deferReply()

    const selectedCategory = interaction.options.getString('category')
    const customCat = interaction.options.getString('custom_category')
    const reason = interaction.options.getString('reason')
    const finalCategory = selectedCategory === 'Custom'
      ? (customCat?.trim() || 'Custom')
      : selectedCategory

    const { data: timerData } = await supabase.from('timer_state').select('start_time').eq('id', 1).single()
    const { data: records } = await supabase.from('spending_records').select('*')

    if (!timerData) return interaction.editReply('Could not fetch timer data.')

    const prevStartTime = timerData.start_time
    const streakMs = Date.now() - prevStartTime
    const now = Date.now()

    const timestamp = new Date(now).toLocaleString('en-PH', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    })

    const longestMs = records?.length ? getLongestStreak(records, prevStartTime) : streakMs
    const wasRecord = streakMs >= longestMs

    await Promise.all([
      supabase.from('timer_state').update({ start_time: now }).eq('id', 1),
      supabase.from('spending_records').insert({
        timestamp,
        reason,
        category: finalCategory,
        prev_start_time: prevStartTime
      })
    ])

    const embed = new EmbedBuilder()
      .setTitle(wasRecord ? '🏆 Joseph broke his record AND his wallet.' : '⚠️ Joseph has fallen.')
      .addFields(
        { name: '📁 Category', value: finalCategory, inline: true },
        { name: '⏱ Streak Was', value: formatStreakDuration(streakMs), inline: true },
        { name: '💬 Reason', value: reason, inline: false },
        { name: '👤 Reset by', value: `<@${interaction.user.id}>`, inline: true },
      )
      .setColor(wasRecord ? 0xfbbf24 : 0xef4444)
      .setFooter({ text: 'Timer has been reset. The suffering begins again.' })
      .setTimestamp()

    const channel = await client.channels.fetch(CHANNEL_ID)
    if (channel) await channel.send({ embeds: [embed] })

    await interaction.editReply({ embeds: [embed] })
  }

  // ── /bet ────────────────────────────────────────────────────────────────────
  if (interaction.commandName === 'bet') {
    await interaction.deferReply({ ephemeral: true })

    const name = interaction.options.getString('name')
    const dateStr = interaction.options.getString('date')
    const amount = interaction.options.getNumber('amount')
    const discordTag = interaction.options.getString('discord_tag') ?? interaction.user.tag

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/
    if (!dateRegex.test(dateStr)) {
      return interaction.editReply('Invalid date format. Use YYYY-MM-DD (e.g. 2026-08-15)')
    }

    const { error } = await supabase.from('bets').insert({
      name,
      discord_tag: discordTag,
      bet_date: dateStr,
      amount
    })

    if (error) return interaction.editReply('Failed to save bet. Try again.')

    await interaction.editReply(`✅ Bet placed! **${name}** bets ₱${amount.toLocaleString()} that Joseph breaks on **${dateStr}**.`)

    const channel = await client.channels.fetch(CHANNEL_ID)
    if (channel) {
      await channel.send(`🎲 **${name}** placed a bet of ₱${amount.toLocaleString()} that Joseph breaks on **${dateStr}**!`)
    }
  }

  // ── /bets ───────────────────────────────────────────────────────────────────
  if (interaction.commandName === 'bets') {
    await interaction.deferReply()

    const { data: bets } = await supabase.from('bets').select('*').order('bet_date', { ascending: true })

    if (!bets || bets.length === 0) return interaction.editReply('No bets placed yet.')

    const now = Date.now()

    const closest = bets.reduce((prev, curr) => {
      const prevDiff = Math.abs(new Date(prev.bet_date).getTime() - now)
      const currDiff = Math.abs(new Date(curr.bet_date).getTime() - now)
      return currDiff < prevDiff ? curr : prev
    })

    const totalPot = bets.reduce((sum, b) => sum + Number(b.amount), 0)

    const lines = bets.map(b => {
      const isWinning = b.id === closest.id
      const daysAway = Math.ceil((new Date(b.bet_date).getTime() - now) / (1000 * 60 * 60 * 24))
      const daysLabel = daysAway > 0 ? `in ${daysAway}d` : daysAway === 0 ? 'today' : `${Math.abs(daysAway)}d ago`
      return `${isWinning ? '👑' : '▫️'} **${b.name}** — ${b.bet_date} (${daysLabel}) — ₱${Number(b.amount).toLocaleString()}`
    }).join('\n')

    const embed = new EmbedBuilder()
      .setTitle('🎲 Betting Pool')
      .setDescription(lines)
      .addFields(
        { name: '💰 Total Pot', value: `₱${totalPot.toLocaleString()}`, inline: true },
        { name: '👑 Currently Winning', value: closest.name, inline: true },
      )
      .setColor(0x8b5cf6)
      .setFooter({ text: 'Closest date to today\'s reset wins the pot' })
      .setTimestamp()

    await interaction.editReply({ embeds: [embed] })
  }

  // ── /scream ─────────────────────────────────────────────────────────────────
  if (interaction.commandName === 'scream') {
    await interaction.deferReply({ ephemeral: true })

    const { data: records } = await supabase
      .from('spending_records')
      .select('*')
      .order('created_at', { ascending: false })

    if (!records || records.length === 0) {
      return interaction.editReply('No spending records found.')
    }

    const latest = records[0]
    await screamInChannel(latest)
    await interaction.editReply('✅ Screamed in channel.')
  }
})

// ── Webhook server (receives Supabase DB webhook when website resets) ─────────

async function screamInChannel(record) {
  try {
    const { data: records } = await supabase.from('spending_records').select('*')

    const prevStartTime = record.prev_start_time
    const streakMs = prevStartTime
      ? new Date(record.timestamp).getTime() - prevStartTime
      : 0

    const longestMs = records?.length && prevStartTime
      ? getLongestStreak(records, prevStartTime)
      : streakMs
    const wasRecord = streakMs > 0 && streakMs >= longestMs

    const category = record.category ?? 'Uncategorized'
    const reason = record.reason ?? '???'

    const embed = new EmbedBuilder()
      .setTitle(wasRecord ? '🏆 HE BROKE HIS RECORD AND HIS WALLET (via website)' : '🚨 JOSEPH SPENT MONEY (via website)')
      .setDescription('The website reset button has been pressed. He has fallen.')
      .addFields(
        { name: '📁 Category', value: category, inline: true },
        { name: '⏱ Streak Was', value: streakMs > 0 ? formatStreakDuration(streakMs) : 'Unknown', inline: true },
        { name: '💬 Reason', value: reason, inline: false },
      )
      .setColor(wasRecord ? 0xfbbf24 : 0xef4444)
      .setFooter({ text: 'Timer has been reset. The suffering begins again.' })
      .setTimestamp()

    const channel = await client.channels.fetch(CHANNEL_ID)
    if (channel) {
      await channel.send({ content: '@here', embeds: [embed] })
    }
  } catch (err) {
    console.error('Failed to scream in channel:', err)
  }
}

const app = express()
app.use(express.json())

app.post('/webhook', async (req, res) => {
  try {
    const payload = req.body
    if (payload.type === 'INSERT' && payload.table === 'spending_records') {
      const record = payload.record
      console.log('Website reset detected:', record)
      res.status(200).json({ ok: true })
      await screamInChannel(record)
    } else {
      res.status(200).json({ ok: true, ignored: true })
    }
  } catch (err) {
    console.error('Webhook error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

app.listen(WEBHOOK_PORT, () => {
  console.log(`Webhook server listening on port ${WEBHOOK_PORT}`)
})

client.login(BOT_TOKEN)
