const { createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice')

const JOIN_SOUND_PATH = process.env.JOIN_SOUND_PATH || './sounds/join.mp3'
const LEAVE_SOUND_PATH = process.env.LEAVE_SOUND_PATH || './sounds/leave.mp3'

const disabledGuilds = new Set() // guildId -> join/leave chimes turned OFF via /joinsound (default: ON)

function setJoinSoundEnabled(guildId, enabled) {
  if (enabled) disabledGuilds.delete(guildId)
  else disabledGuilds.add(guildId)
}

function isJoinSoundEnabled(guildId) {
  return !disabledGuilds.has(guildId)
}

// Plays a sound on an ALREADY-CONNECTED voice connection (the one /modjoin opened).
// This never joins or leaves a channel on its own.
async function playSoundOnConnection(connection, soundPath, tag) {
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
}

async function playJoinSound(connection) {
  await playSoundOnConnection(connection, JOIN_SOUND_PATH, 'join-sound')
}

async function playLeaveSound(connection) {
  await playSoundOnConnection(connection, LEAVE_SOUND_PATH, 'leave-sound')
}

module.exports = { playJoinSound, playLeaveSound, setJoinSoundEnabled, isJoinSoundEnabled }
