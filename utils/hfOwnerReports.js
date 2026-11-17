const { getBotOwnerIds } = require('./hfPermissions');

async function reportToMainServer(client, content) {
  const guildId = String(process.env.HF_MAIN_GUILD_ID || '').trim();
  const channelId = String(process.env.HF_OWNER_LOG_CHANNEL_ID || '').trim();
  if (!guildId || !channelId || !client) return false;

  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  const channel = guild?.channels?.cache?.get(channelId)
    || await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) return false;

  const ownerMentions = getBotOwnerIds().map(userId => `<@${userId}>`).join(' ');
  return Boolean(await channel.send({
    content: `${ownerMentions}\n${content}`.trim(),
    allowedMentions: { users: getBotOwnerIds() }
  }).catch(() => null));
}

module.exports = { reportToMainServer };