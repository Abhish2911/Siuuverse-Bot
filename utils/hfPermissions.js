const HFTournamentAccess = require('../models/HFTournamentAccess');

function getBotOwnerIds() {
  return String(process.env.OWNER_IDS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

function isBotOwner(userId) {
  return getBotOwnerIds().includes(String(userId));
}

async function getAccess(message) {
  if (isBotOwner(message.author.id)) return { level: 'botOwner' };
  if (!message.guild) return null;
  return HFTournamentAccess.findOne({
    guildId: message.guild.id,
    userId: message.author.id
  }).lean();
}

async function hasHFPermission(message, permission) {
  const access = await getAccess(message);
  if (!access) return false;
  if (access.level === 'botOwner' || access.level === 'admin') return true;
  return access.permissions?.[permission] === true;
}

module.exports = { getBotOwnerIds, isBotOwner, getAccess, hasHFPermission };