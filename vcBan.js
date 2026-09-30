// ── VC Ban ──────────────────────────────────────────────────────────────────
// Automatically disconnects a specific user whenever they join (or get moved
// into) any voice channel, then posts a message in a fixed text channel.
// The bot does NOT need to be in a VC. It only needs to be online and have the
// "Move Members" permission in the guild.

const VC_BAN_USER_ID = '749534042017234974'
const VC_BAN_CHANNEL_ID = '1298186869342998530'

async function handleVcBan(oldState, newState, client) {
  const userId = newState.id
  if (userId !== VC_BAN_USER_ID) return

  // Only react when they enter a voice channel (join or switch), not on mute/deafen/leave
  if (!newState.channelId || newState.channelId === oldState.channelId) return

  try {
    await newState.member.voice.disconnect('VC ban: user is not allowed in voice')
  } catch (err) {
    console.error('[vc-ban] failed to disconnect user:', err.message || err)
    return
  }

  try {
    const channel = client.channels.cache.get(VC_BAN_CHANNEL_ID) ?? await client.channels.fetch(VC_BAN_CHANNEL_ID)
    if (channel) {
      await channel.send({
        content: `<@${VC_BAN_USER_ID}> BAWAL SA VC, NO VC FOR YOU`,
        allowedMentions: { users: [VC_BAN_USER_ID] },
      })
    }
  } catch (err) {
    console.error('[vc-ban] failed to send message:', err.message || err)
  }
}

module.exports = { handleVcBan, VC_BAN_USER_ID, VC_BAN_CHANNEL_ID }
