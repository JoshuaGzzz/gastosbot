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
const COOLDOWN_MS = 3000 // stops back-to-back joins from overlapping playback

const lastPlayed = new Map() // guildId -> timestamp
const disabledGuilds = new Set() // guildId -> join sound turned off via /joinsound

function setJoinSoundEnabled(guildId, enabled) {
  if (enabled) disabledGuilds.delete(guildId)
  else disabledGuilds.add(guildId)
}

function isJoinSoundEnabled(guildId) {
  return !disabledGuilds.has(guildId)
}

async function playJoinSound(voiceChannel) {
  const guildId = voiceChannel.guild.id

  if (!isJoinSoundEnabled(guildId)) return
  // Voice moderation and the join sound share one voice connection per guild —
  // joining a different channel here would drag /modjoin's connection away
  // from the channel it's supposed to be listening to.
  if (isModerating(guildId)) return

  const now = Date.now()
  if (now - (lastPlayed.get(guildId) || 0) < COOLDOWN_MS) return
  lastPlayed.set(guildId, now)

  let connection = getVoiceConnection(guildId)
  if (!connection || connection.joinConfig.channelId !== voiceChannel.id) {
    connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
    })
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000)
    } catch (err) {
      console.error('[join-sound] failed to connect:', err.message)
      return
    }
  }

  const player = createAudioPlayer()
  const resource = createAudioResource(JOIN_SOUND_PATH, { inlineVolume: true })
  resource.volume?.setVolumeLogarithmic(0.5)
  connection.subscribe(player)
  player.play(resource)

  await new Promise(resolve => {
    player.once(AudioPlayerStatus.Idle, resolve)
    player.once('error', resolve)
  })
}

module.exports = { playJoinSound, setJoinSoundEnabled, isJoinSoundEnabled }
