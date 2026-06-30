const {
  joinVoiceChannel,
  getVoiceConnection,
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice')
const prism = require('prism-media')
const { DeepgramClient } = require('@deepgram/sdk')

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY
const deepgram = DEEPGRAM_API_KEY ? new DeepgramClient({ apiKey: DEEPGRAM_API_KEY }) : null

// Optional: force a specific language via Railway env var, e.g. DEEPGRAM_LANGUAGE=tl or =en
// If unset, we restrict detection to English + Tagalog only (see openLiveConnection).
const DEEPGRAM_LANGUAGE = process.env.DEEPGRAM_LANGUAGE || null

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

async function openLiveConnection({ onTranscript, onError }) {
  if (!deepgram) return null

  const options = {
    model: 'nova-3',
    encoding: 'linear16',
    sample_rate: 48000,
    channels: 2,
    interim_results: 'true', // partial transcripts as words come in, not just at end-of-turn
    endpointing: 300,        // ms of silence before Deepgram finalizes an utterance
  }

  if (DEEPGRAM_LANGUAGE) {
    options.language = DEEPGRAM_LANGUAGE
  } else {
    // Restrict detection to English + Tagalog only, instead of all ~35
    // languages Deepgram can detect.
    options.detect_language = ['en', 'tl']
  }

  const connection = await deepgram.listen.v1.connect(options)

  connection.on('message', data => {
    if (data.type !== 'Results') return
    const transcript = data?.channel?.alternatives?.[0]?.transcript
    if (transcript) onTranscript(transcript, data.is_final === true)
  })

  connection.on('error', err => {
    console.error('[voice-mod] Deepgram live error:', err?.message || err)
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
  let liveTranscript = ''
  let dgConnection = null
  let closed = false

  openLiveConnection({
    onTranscript: async (transcript, isFinal) => {
      liveTranscript = transcript
      if (flagged) return // already handled this speaker's utterance
      const hit = findHit(transcript)
      if (hit) {
        flagged = true
        console.log(`[voice-mod] ${userId} flagged on ${isFinal ? 'final' : 'interim'} result: "${transcript}"`)
        await onMatch(userId, transcript, hit)
      }
    },
    onError: () => {
      // Logged inside openLiveConnection.
    },
  })
    .then(connection => {
      dgConnection = connection
      if (closed) {
        // Decoder already finished before the socket finished opening — close it now.
        try { connection.close() } catch (err) { /* already closed */ }
      }
    })
    .catch(err => {
      console.error('[voice-mod] failed to open Deepgram connection:', err.message || err)
      onDone()
    })

  opusStream.pipe(decoder)
  decoder.on('data', chunk => {
    if (dgConnection) dgConnection.sendMedia(chunk)
  })

  const cleanup = () => {
    onDone()
    if (liveTranscript && !flagged) {
      console.log(`[voice-mod] ${userId}: "${liveTranscript}" (no match)`)
    }
    closed = true
    if (dgConnection) {
      try {
        dgConnection.sendCloseStream({ type: 'CloseStream' })
        dgConnection.close()
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
      if (textChannel) {
        await textChannel.send(
          `🔇 Disconnected <@${userId}> from voice — flagged word detected.`
        )
      }
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

module.exports = { startModeration, stopModeration, isModerating }
