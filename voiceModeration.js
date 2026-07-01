const { 
  joinVoiceChannel,
  getVoiceConnection,
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
} = require('@discordjs/voice')
const prism = require('prism-media')
const { DeepgramClient } = require('@deepgram/sdk')
const { createClient: createSupabaseClient } = require('@supabase/supabase-js')

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY
const deepgram = DEEPGRAM_API_KEY ? new DeepgramClient({ apiKey: DEEPGRAM_API_KEY }) : null

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_KEY
const supabase = (SUPABASE_URL && SUPABASE_KEY) ? createSupabaseClient(SUPABASE_URL, SUPABASE_KEY) : null

const ffmpeg = require('ffmpeg-static')
process.env.PATH = `${require('path').dirname(ffmpeg)}:${process.env.PATH}`

async function recordDisconnect(userId, flaggedWord) {
  if (!supabase) return
  const { error } = await supabase.from('voice_disconnects').insert({ user_id: userId, flagged_word: flaggedWord })
  if (error) console.error('[voice-mod] failed to record disconnect:', error.message)
}

async function getLeaderboard(limit = 10) {
  if (!supabase) return []
  const { data, error } = await supabase.from('voice_disconnects').select('user_id')
  if (error) {
    console.error('[voice-mod] failed to fetch leaderboard:', error.message)
    return []
  }
  const counts = new Map()
  for (const row of data) counts.set(row.user_id, (counts.get(row.user_id) || 0) + 1)
  return [...counts.entries()]
    .map(([userId, count]) => ({ userId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

const STREAMING_LANGUAGES = (process.env.DEEPGRAM_LANGUAGES || 'en,tl')
  .split(',').map(l => l.trim()).filter(Boolean)

// guildId -> { connection, textChannel, buffering, voiceChannelId, voiceStateHandler, cleanup }
const activeSessions = new Map()

// guildId -> Map<userId, { dgConnections, lastTranscriptByLang, flaggedRef }>
const userConnectionsMap = new Map()

// ── Wordlist ──────────────────────────────────────────────────────────────────

let cachedWordlistRaw = null
let cachedWordlist = null
let cachedRegex = null

function loadWordlist() {
  const raw = process.env.BAD_WORDS
  if (!raw) { console.warn('[voice-mod] BAD_WORDS env var not set — nothing will be flagged.'); return [] }
  if (raw === cachedWordlistRaw) return cachedWordlist
  cachedWordlistRaw = raw
  cachedWordlist = raw.split(',').map(w => w.toLowerCase().trim()).filter(Boolean)
  cachedRegex = buildRegex(cachedWordlist)
  return cachedWordlist
}

function buildRegex(wordlist) {
  if (wordlist.length === 0) return null
  const escaped = wordlist.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  return new RegExp(`\\b(?:${escaped})\\b`, 'i')
}

function findHit(transcript) {
  if (!transcript) return null
  loadWordlist()
  if (!cachedRegex) return null
  const match = transcript.toLowerCase().match(cachedRegex)
  return match ? match[0] : null
}

// ── Deepgram connection management ────────────────────────────────────────────

async function openLiveConnection(language, { onTranscript, onError }) {
  if (!deepgram) return null

  const connection = await deepgram.listen.v1.connect({
    model: 'nova-3',
    encoding: 'linear16',
    sample_rate: 48000,
    channels: 2,
    interim_results: 'true',
    endpointing: 300,
    language,
  })

  connection.on('message', data => {
    if (data.type !== 'Results') return
    const transcript = data?.channel?.alternatives?.[0]?.transcript
    if (transcript) onTranscript(transcript, data.is_final === true)
  })

  connection.on('error', err => {
    console.error(`[voice-mod] Deepgram live error (${language}):`, err?.message || err)
    onError?.(err)
  })

  connection.connect()
  await connection.waitForOpen()
  return connection
}

async function openUserConnections(guildId, userId, onMatch) {
  if (userConnectionsMap.get(guildId)?.has(userId)) return

  const lastTranscriptByLang = {}
  const flaggedRef = { flagged: false }

  const dgConnections = await Promise.all(
    STREAMING_LANGUAGES.map(language =>
      openLiveConnection(language, {
        onTranscript: async (transcript, isFinal) => {
          lastTranscriptByLang[language] = transcript
          if (flaggedRef.flagged) return
          const hit = findHit(transcript)
          if (hit) {
            flaggedRef.flagged = true
            setTimeout(() => { flaggedRef.flagged = false }, 5000)
            console.log(`[voice-mod] ${userId} flagged (${language}, ${isFinal ? 'final' : 'interim'}): "${transcript}"`)
            await onMatch(userId, transcript, hit)
          }
        },
        onError: () => {},
      }).catch(err => {
        console.error(`[voice-mod] failed to open Deepgram connection for ${userId} (${language}):`, err.message || err)
        return null
      })
    )
  )

  if (!userConnectionsMap.has(guildId)) userConnectionsMap.set(guildId, new Map())
  userConnectionsMap.get(guildId).set(userId, { dgConnections, lastTranscriptByLang, flaggedRef })
  console.log(`[voice-mod] opened ${STREAMING_LANGUAGES.length} Deepgram connection(s) for ${userId}`)
}

function closeUserConnections(guildId, userId) {
  const entry = userConnectionsMap.get(guildId)?.get(userId)
  if (!entry) return
  for (const conn of entry.dgConnections) {
    if (!conn) continue
    try { conn.sendCloseStream({ type: 'CloseStream' }); conn.close() } catch (_) {}
  }
  userConnectionsMap.get(guildId).delete(userId)
  console.log(`[voice-mod] closed Deepgram connections for ${userId}`)
}

function closeAllUserConnections(guildId) {
  const guildMap = userConnectionsMap.get(guildId)
  if (!guildMap) return
  for (const userId of [...guildMap.keys()]) closeUserConnections(guildId, userId)
  userConnectionsMap.delete(guildId)
}

// ── Per-utterance audio piping (reuses persistent connections) ────────────────

function listenToUser(voiceConnection, userId, guildId, onDone) {
  const entry = userConnectionsMap.get(guildId)?.get(userId)
  if (!entry) { onDone(); return }

  const opusStream = voiceConnection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 700 },
  })

  const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 })
  opusStream.pipe(decoder)

  decoder.on('data', chunk => {
    for (const conn of entry.dgConnections) {
      if (conn) conn.sendMedia(chunk)
    }
  })

  const cleanup = () => {
    onDone()
    try { opusStream.unpipe(decoder); decoder.destroy() } catch (_) {}
  }

  decoder.on('end', cleanup)
  opusStream.on('error', err => { console.error('[voice-mod] opus stream error:', err.message || err); cleanup() })
  decoder.on('error', err => { console.error('[voice-mod] decoder error:', err.message || err) })
}

// ── Public API ────────────────────────────────────────────────────────────────

async function startModeration(voiceChannel, textChannel) {
  if (!deepgram) throw new Error('DEEPGRAM_API_KEY is not set in env — cannot start voice moderation.')

  const guild = voiceChannel.guild
  if (activeSessions.has(guild.id)) throw new Error('Voice moderation is already running in this server. Use /modleave first.')

  let connection = getVoiceConnection(guild.id)
  if (!connection) {
    connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: true,
    })
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000)
  }

  const session = { connection, textChannel, buffering: new Set(), voiceChannelId: voiceChannel.id }
  activeSessions.set(guild.id, session)

  const onMatch = async (userId, transcript, hit) => {
    try {
      const member = await guild.members.fetch(userId)
      if (!member.voice.channel) return
      await member.voice.disconnect('Voice moderation: flagged word detected')
      closeUserConnections(guild.id, userId)
      await recordDisconnect(userId, hit)
      if (textChannel) await textChannel.send(`🔇 Disconnected <@${userId}> from voice — flagged word detected: "${hit}"`)

      const player = createAudioPlayer()
      const resource = createAudioResource('./sounds/fahhhhhhhhhhhhhhh.mp3', { inlineVolume: true })
      resource.volume.setVolumeLogarithmic(0.25)
      connection.subscribe(player)
      player.play(resource)
      await new Promise((resolve, reject) => {
        player.on(AudioPlayerStatus.Idle, resolve)
        player.on('error', reject)
      })
    } catch (err) {
      console.error('[voice-mod] failed to disconnect flagged user:', err.message || err)
    }
  }

  // Open connections for everyone already in the channel
  const currentMembers = voiceChannel.members.filter(m => !m.user.bot)
  console.log(`[voice-mod] opening connections for ${currentMembers.size} existing member(s)`)
  await Promise.all(currentMembers.map(m => openUserConnections(guild.id, m.id, onMatch)))

  // Track members joining / leaving this specific channel
  const voiceStateHandler = async (oldState, newState) => {
    if (oldState.guild.id !== guild.id) return
    if (newState.member?.user?.bot) return

    const joinedThisChannel = newState.channelId === voiceChannel.id && oldState.channelId !== voiceChannel.id
    const leftThisChannel = oldState.channelId === voiceChannel.id && newState.channelId !== voiceChannel.id

    if (joinedThisChannel) {
      console.log(`[voice-mod] ${newState.id} joined — opening Deepgram connections`)
      await openUserConnections(guild.id, newState.id, onMatch)
    }
    if (leftThisChannel) {
      console.log(`[voice-mod] ${newState.id} left — closing Deepgram connections`)
      closeUserConnections(guild.id, newState.id)
    }
  }

  guild.client.on('voiceStateUpdate', voiceStateHandler)
  session.voiceStateHandler = voiceStateHandler

  // Pipe utterances into persistent Deepgram connections
  connection.receiver.speaking.on('start', async userId => {
    if (session.buffering.has(userId)) return
    const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null))
    if (!member || member.user.bot) return
    session.buffering.add(userId)
    listenToUser(connection, userId, guild.id, () => session.buffering.delete(userId))
  })

  const cleanup = () => {
    guild.client.removeListener('voiceStateUpdate', voiceStateHandler)
    closeAllUserConnections(guild.id)
    activeSessions.delete(guild.id)
  }

  session.cleanup = cleanup
  connection.on(VoiceConnectionStatus.Disconnected, cleanup)

  return connection
}

function stopModeration(guildId) {
  const session = activeSessions.get(guildId)
  if (session) {
    session.cleanup?.()
    session.connection.destroy()
    return true
  }
  const existing = getVoiceConnection(guildId)
  if (existing) { existing.destroy(); return true }
  return false
}

function isModerating(guildId) {
  return activeSessions.has(guildId)
}

module.exports = { startModeration, stopModeration, isModerating, getLeaderboard }
