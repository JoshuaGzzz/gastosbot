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
  const { error } = await supabase.from('voice_disconnects').insert({
    user_id: userId,
    flagged_word: flaggedWord,
  })
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
  for (const row of data) {
    counts.set(row.user_id, (counts.get(row.user_id) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([userId, count]) => ({ userId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

// Which languages to transcribe in parallel is controlled by DEEPGRAM_LANGUAGES
// below (defaults to English + Tagalog) — see STREAMING_LANGUAGES.

// guildId -> { connection, textChannel, buffering: Set<userId> }
const activeSessions = new Map()

// ── Wordlist ─────────────────────────────────────────────────────────────────
// Set the BAD_WORDS environment variable directly in Railway's dashboard —
// comma-separated, e.g.  word one,word two,phrase three
// This never touches git or your local machine.
// Matching is whole-word (case-insensitive), so "ass" won't match "class".

let cachedWordlistRaw = null
let cachedWordlist = null
let cachedRegex = null

function loadWordlist() {
  const raw = process.env.BAD_WORDS
  if (!raw) {
    console.warn('[voice-mod] BAD_WORDS env var not set — nothing will be flagged.')
    return []
  }
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
  loadWordlist() // ensures cachedRegex is current
  if (!cachedRegex) return null
  const match = transcript.toLowerCase().match(cachedRegex)
  return match ? match[0] : null
}

// ── Streaming transcription ──────────────────────────────────────────────────
// PCM is streamed to Deepgram as it arrives over a WebSocket, instead of
// buffering a whole utterance and sending one HTTP call at the end. This is
// the @deepgram/sdk v5 "listen.v1.connect" streaming API.

// Languages to run in parallel — one streaming connection per language per
// speaker. Override with DEEPGRAM_LANGUAGES (comma-separated) if you ever
// want to change the pair without editing code.
const STREAMING_LANGUAGES = (process.env.DEEPGRAM_LANGUAGES || 'en,tl')
  .split(',')
  .map(l => l.trim())
  .filter(Boolean)

async function openLiveConnection(language, { onTranscript, onError }) {
  if (!deepgram) return null

  const options = {
    model: 'nova-3',
    encoding: 'linear16',
    sample_rate: 48000,
    channels: 2,
    interim_results: 'true', // partial transcripts as words come in, not just at end-of-turn
    endpointing: 300,        // ms of silence before Deepgram finalizes an utterance
    language,
  }

  const connection = await deepgram.listen.v1.connect(options)

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

// ── Per-speaker listening ────────────────────────────────────────────────────

function listenToUser(voiceConnection, userId, onMatch, onDone) {
  if (!deepgram) {
    onDone()
    return
  }

  const opusStream = voiceConnection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 700 },
  })

  const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 })

  let flagged = false
  let closed = false
  const lastTranscriptByLang = {}

  // One Deepgram connection per language, all fed the same audio in parallel.
  // dgConnections[i] corresponds to STREAMING_LANGUAGES[i].
  const dgConnections = new Array(STREAMING_LANGUAGES.length).fill(null)

  STREAMING_LANGUAGES.forEach((language, i) => {
    openLiveConnection(language, {
      onTranscript: async (transcript, isFinal) => {
        lastTranscriptByLang[language] = transcript
        if (flagged) return // some language connection already caught a hit
        const hit = findHit(transcript)
        if (hit) {
          flagged = true
          console.log(`[voice-mod] ${userId} flagged (${language}, ${isFinal ? 'final' : 'interim'}): "${transcript}"`)
          await onMatch(userId, transcript, hit)
        }
      },
      onError: () => {
        // Logged inside openLiveConnection.
      },
    })
      .then(connection => {
        dgConnections[i] = connection
        if (closed) {
          try { connection.close() } catch (err) { /* already closed */ }
        }
      })
      .catch(err => {
        console.error(`[voice-mod] failed to open Deepgram connection (${language}):`, err.message || err)
      })
  })

  opusStream.pipe(decoder)
  decoder.on('data', chunk => {
    for (const connection of dgConnections) {
      if (connection) connection.sendMedia(chunk)
    }
  })

  const cleanup = () => {
    onDone()
    if (!flagged) {
      const summary = STREAMING_LANGUAGES
        .map(lang => lastTranscriptByLang[lang] && `${lang}: "${lastTranscriptByLang[lang]}"`)
        .filter(Boolean)
        .join(' | ')
      if (summary) console.log(`[voice-mod] ${userId}: ${summary} (no match)`)
    }
    closed = true
    for (const connection of dgConnections) {
      if (!connection) continue
      try {
        connection.sendCloseStream({ type: 'CloseStream' })
        connection.close()
      } catch (err) { /* already closed */ }
    }
  }

  decoder.on('end', cleanup)
  opusStream.on('error', err => {
    console.error('[voice-mod] opus stream error:', err.message || err)
    cleanup()
  })
  decoder.on('error', err => {
    console.error('[voice-mod] decoder error:', err.message || err)
  })
}

// ── Public API ────────────────────────────────────────────────────────────────

async function startModeration(voiceChannel, textChannel) {
  if (!deepgram) {
    throw new Error('DEEPGRAM_API_KEY is not set in env — cannot start voice moderation.')
  }

  const guild = voiceChannel.guild

  if (activeSessions.has(guild.id)) {
    throw new Error('Voice moderation is already running in this server. Use /modleave first.')
  }

  let connection = getVoiceConnection(guild.id)
  if (!connection) {
    connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false, // must NOT be deafened, or we receive no audio
      selfMute: true,  // bot has no reason to transmit
    })
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000)
  }

  const session = { connection, textChannel, buffering: new Set() }
  activeSessions.set(guild.id, session)

const onMatch = async (userId, transcript, hit) => {
  try {
    const member = await guild.members.fetch(userId)
    if (!member.voice.channel) return
    await member.voice.disconnect('Voice moderation: flagged word detected')
    await recordDisconnect(userId, hit)
    if (textChannel) {
      await textChannel.send(
        `🔇 Disconnected <@${userId}> from voice — flagged word detected: "${hit}"`
      )
    }

    const player = createAudioPlayer()
    const resource = createAudioResource('./sounds/fahhhhhhhhhhhhhhh.mp3', {
      inlineVolume: true
    })
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
  
  connection.receiver.speaking.on('start', async userId => {
    if (session.buffering.has(userId)) return

    const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null))
    if (!member || member.user.bot) return

    session.buffering.add(userId)
    listenToUser(
      connection,
      userId,
      onMatch,
      () => session.buffering.delete(userId)
    )
  })

  connection.on(VoiceConnectionStatus.Disconnected, () => {
    activeSessions.delete(guild.id)
  })

  return connection
}

function stopModeration(guildId) {
  const session = activeSessions.get(guildId)
  if (session) {
    session.connection.destroy()
    activeSessions.delete(guildId)
    return true
  }
  const existing = getVoiceConnection(guildId)
  if (existing) {
    existing.destroy()
    return true
  }
  return false
}

function isModerating(guildId) {
  return activeSessions.has(guildId)
}

module.exports = { startModeration, stopModeration, isModerating, getLeaderboard }
