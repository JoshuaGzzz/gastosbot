const {
  joinVoiceChannel,
  getVoiceConnection,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice')
const { isModerating } = require('./voiceModeration')

const JOIN_SOUND_PATH = process.env.JOIN_SOUND_PATH || './sounds/join.mp3'
const LEAVE_SOUND_PATH = process.env.LEAVE_SOUND_PATH || './sounds/leave.mp3'
const COOLDOWN_MS = 3000 // stops back-to-back joins from overlapping playback

const lastPlayed = new Map() // guildId -> timestamp
const disabledGuilds = new Set() // guildId -> join sound turned OFF via /joinsound (default: ON)

function setJoinSoundEnabled(guildId, enabled) {
  if (enabled) disabledGuilds.delete(guildId)
  else disabledGuilds.add(guildId)
}

function isJoinSoundEnabled(guildId) {
  return !disabledGuilds.has(guildId)
}

async function playSoundAndLeave(voiceChannel, soundPath, tag) {
  const guildId = voiceChannel.guild.id

  if (!isJoinSoundEnabled(guildId)) return
  // Never steal the connection from active /modjoin moderation
  if (isModerating(guildId)) return

  const now = Date.now()
  if (now - (lastPlayed.get(guildId) || 0) < COOLDOWN_MS) return
  lastPlayed.set(guildId, now)

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: true,
  })

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000)
  } catch (err) {
    console.error(`[${tag}] failed to connect:`, err.message)
    connection.destroy()
    return
  }

  const player = createAudioPlayer()
  const resource = createAudioResource(soundPath, { inlineVolume: true })
  resource.volume?.setVolumeLogarithmic(0.5)
  connection.subscribe(player)
  player.play(resource)

  await new Promise(resolve => {
    player.once(AudioPlayerStatus.Idle, resolve)
    player.once('error', err => {
      console.error(`[${tag}] playback error:`, err.message)
      resolve()
    })
  })

  // Always leave right after playing — don't camp in the channel
  connection.destroy()
}

async function playJoinSound(voiceChannel) {
  await playSoundAndLeave(voiceChannel, JOIN_SOUND_PATH, 'join-sound')
}

async function playLeaveSound(voiceChannel) {
  await playSoundAndLeave(voiceChannel, LEAVE_SOUND_PATH, 'leave-sound')
}

module.exports = { playJoinSound, playLeaveSound, setJoinSoundEnabled, isJoinSoundEnabled }
