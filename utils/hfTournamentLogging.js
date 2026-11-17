const HFTournament = require('../models/HFTournament');

async function getActiveTournament(guildId) {
  return HFTournament.findOne({
    guildId,
    status: { $in: ['registration', 'active'] }
  }).sort({ createdAt: -1 });
}

async function sendTournamentLog(guild, channelId, content) {
  if (!channelId) return false;
  const channel = guild.channels.cache.get(channelId)
    || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) return false;
  return Boolean(await channel.send({ content }).catch(() => null));
}

module.exports = { getActiveTournament, sendTournamentLog };
