const {
  joinVoiceChannel,
  getVoiceConnection,
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice')
const prism = require('prism-media')
const { createClient } = require('@deepgram/sdk')

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY
const deepgram = DEEPGRAM_API_KEY ? createClient(DEEPGRAM_API_KEY) : null

// guildId -> { connection, textChannel, buffering: Set<userId> }
const activeSessions = new Map()

// ── Wordlist ─────────────────────────────────────────────────────────────────
// Set the BAD_WORDS environment variable directly in Railway's dashboard —
// comma-separated, e.g.  word one,word two,phrase three
// This never touches git or your local machine.
// Matching is whole-word (case-insensitive), so "ass" won't match "class".

function loadWordlist() {
  const raw = process.env.BAD_WORDS
  if (!raw) {
    console.warn('[voice-mod] BAD_WORDS env var not set — nothing will be flagged.')
    return []
  }
  return raw.split(',').map(w => w.toLowerCase().trim()).filter(Boolean)
}

function findHit(transcript, wordlist) {
  if (!transcript || wordlist.length === 0) return null
  const normalized = transcript.toLowerCase()
  for (const word of wordlist) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`\\b${escaped}\\b`, 'i')
    if (re.test(normalized)) return word
  }
  return null
}

// ── Transcription ────────────────────────────────────────────────────────────

async function transcribePcm(pcmBuffer) {
  if (!deepgram) return ''
  if (pcmBuffer.length < 3200) return '' // skip near-silent blips (<~17ms of stereo 48k)
  try {
    const response = await deepgram.listen.v1.media.transcribeFile(pcmBuffer, {
      model: 'nova-3',
      encoding: 'linear16',
      sample_rate: 48000,
      channels: 2,
      smart_format: true,
    })
    return response?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? ''
  } catch (err) {
    console.error('[voice-mod] Deepgram transcription failed:', err.message || err)
    return ''
  }
}

// ── Per-speaker listening ────────────────────────────────────────────────────

function listenToUser(connection, userId, onMatch, onDone) {
  const opusStream = connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 700 },
  })

  const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 })
  const chunks = []

  opusStream.pipe(decoder)
  decoder.on('data', chunk => chunks.push(chunk))

  const cleanup = async () => {
    onDone()
    const pcmBuffer = Buffer.concat(chunks)
    const transcript = await transcribePcm(pcmBuffer)
    if (transcript) {
      console.log(`[voice-mod] ${userId}: "${transcript}"`)
      const wordlist = loadWordlist()
      const hit = findHit(transcript, wordlist)
      if (hit) await onMatch(userId, transcript, hit)
    }
  }

  decoder.on('end', cleanup)
  opusStream.on('error', err => {
    console.error('[voice-mod] opus stream error:', err.message || err)
    onDone()
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
