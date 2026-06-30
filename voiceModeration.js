const {
  joinVoiceChannel,
  getVoiceConnection,
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice')
const prism = require('prism-media')
const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk')

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY
const deepgram = DEEPGRAM_API_KEY ? createClient(DEEPGRAM_API_KEY) : null

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
  // Only rebuild if the underlying env value actually changed — loadWordlist()
  // used to allocate a new array every call, which made the old reference-equality
  // cache check in findHit() never hit.
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
// Replaces the old buffer-the-whole-utterance + batch-transcribe approach.
// PCM is streamed to Deepgram as it arrives, so moderation can fire on a partial
// result mid-sentence instead of waiting for ~700ms of silence + a full upload.

function openLiveConnection({ onTranscript, onError }) {
  if (!deepgram) return null

  const liveOptions = {
    model: 'nova-3',
    encoding: 'linear16',
    sample_rate: 48000,
    channels: 2,
    interim_results: true, // get partial transcripts as words come in, not just at end-of-turn
    endpointing: 300,      // ms of silence Deepgram waits before finalizing an utterance
    smart_format: false,   // not needed for raw wordlist matching — skip the extra work
  }

  if (DEEPGRAM_LANGUAGE) {
    liveOptions.language = DEEPGRAM_LANGUAGE
  } else {
    // Restrict to English + Tagalog only. NOTE: verify against your installed
    // @deepgram/sdk version that array values get serialized as repeated query
    // params (detect_language=en&detect_language=tl) — some SDK versions may
    // need this passed differently. Test with a live request and inspect the
    // outgoing URL before trusting this in production.
    liveOptions.detect_language = ['en', 'tl']
  }

  const live = deepgram.listen.live(liveOptions)

  live.on(LiveTranscriptionEvents.Open, () => {
    live.on(LiveTranscriptionEvents.Transcript, data => {
      const transcript = data?.channel?.alternatives?.[0]?.transcript
      if (transcript) onTranscript(transcript, data.is_final === true)
    })

    live.on(LiveTranscriptionEvents.Error, err => {
      console.error('[voice-mod] Deepgram live error:', err?.message || err)
      onError?.(err)
    })

    live.on(LiveTranscriptionEvents.Close, () => {
      // Connection closed — nothing to do, listenToUser's cleanup handles state.
    })
  })

  return live
}

// ── Per-speaker listening ────────────────────────────────────────────────────

function listenToUser(connection, userId, onMatch, onDone) {
  if (!deepgram) {
    onDone()
    return
  }

  const opusStream = connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 700 },
  })

  const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 })

  let flagged = false
  let liveTranscript = ''

  const live = openLiveConnection({
    onTranscript: async (transcript, isFinal) => {
      // Keep the latest text around for logging even if nothing matches.
      liveTranscript = transcript

      if (flagged) return // already handled this speaker's utterance, ignore further results
      const hit = findHit(transcript)
      if (hit) {
        flagged = true
        console.log(`[voice-mod] ${userId} flagged on ${isFinal ? 'final' : 'interim'} result: "${transcript}"`)
        await onMatch(userId, transcript, hit)
      }
    },
    onError: () => {
      // Logged inside openLiveConnection; nothing further to do here.
    },
  })

  if (!live) {
    onDone()
    return
  }

  opusStream.pipe(decoder)
  decoder.on('data', chunk => {
    // live.getReadyState() === 1 means OPEN; guard against sending before
    // the socket handshake completes or after it's been torn down.
    if (live.getReadyState() === 1) live.send(chunk)
  })

  const cleanup = () => {
    onDone()
    if (liveTranscript && !flagged) {
      console.log(`[voice-mod] ${userId}: "${liveTranscript}" (no match)`)
    }
    try { live.requestClose() } catch (err) { /* already closed */ }
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
