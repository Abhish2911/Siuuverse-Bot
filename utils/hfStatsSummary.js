const { EmbedBuilder } = require('discord.js');
const HFStatsSummary = require('../models/HFStatsSummary');
const E = require('./emojis');
const { findPlayerByUserId, loadHandFootballData } = require('./handfootball');

const STAT_FIELDS = [
  ['goals', E.goal, 'Goals'],
  ['assists', E.assist, 'Assists'],
  ['interceptions', E.interception, 'Interceptions'],
  ['tackles', E.tackle, 'Tackles'],
  ['saves', E.save, 'Saves'],
  ['matches', E.played, 'Matches']
];

function getResultRoleIds() {
  return [...new Set([
    ...String(process.env.HF_RESULT_ROLE_ID || '').split(','),
    ...String(process.env.HF_RESULT_ROLE_IDS || '').split(',')
  ].map(value => value.replace(/[<@&>]/g, '').trim()).filter(Boolean))];
}

function totalFor(rows, field) {
  return rows.reduce((sum, row) => sum + (Number(row[field]) || 0), 0);
}

function buildStatsSummaryEmbed(rows, sourceMessage, players) {
  const totals = STAT_FIELDS
    .map(([field, emoji, label]) => `${emoji || ''} **${label}:** ${totalFor(rows, field)}`)
    .join('\n');

  const updatedPlayers = rows.map(row => {
    const player = findPlayerByUserId(players, row.userId);
    const name = player?.player || `<@${row.userId}>`;
    const changes = STAT_FIELDS
      .filter(([field]) => (Number(row[field]) || 0) > 0)
      .map(([field, emoji]) => `${emoji || field} ${Number(row[field]) || 0}`)
      .join(' + ');
    return `${name}: ${changes || 'No changes'}`;
  }).join('\n');

  const sourceLink = sourceMessage?.guildId && sourceMessage?.channelId && sourceMessage?.id
    ? `[View source message](https://discord.com/channels/${sourceMessage.guildId}/${sourceMessage.channelId}/${sourceMessage.id})`
    : 'Source message unavailable';

  return new EmbedBuilder()
    .setTitle(`${E.Stats || '📊'} Stats Update Details`)
    .setColor(0x2ECC71)
    .setDescription([
      '**HandFootball Tournament**',
      `Processed: **${rows.length}**`,
      '',
      '**Totals Added**',
      totals,
      '',
      '**Updated Players**',
      updatedPlayers || 'None',
      '',
      sourceLink
    ].join('\n'))
    .setFooter({ text: 'HandFootball • Match stats summary' })
    .setTimestamp();
}

async function getRoleMembers(guild) {
  const roleIds = getResultRoleIds();
  const members = new Map();
  for (const roleId of roleIds) {
    const role = guild.roles.cache.get(roleId)
      || await guild.roles.fetch(roleId).catch(() => null);
    if (!role) continue;
    for (const member of role.members.values()) members.set(member.id, member);
  }

  const fetchedMembers = await guild.members.fetch().catch(() => null);
  if (fetchedMembers) {
    for (const member of fetchedMembers.values()) {
      if (roleIds.some(roleId => member.roles.cache.has(roleId))) {
        members.set(member.id, member);
      }
    }
  }

  return [...members.values()];
}

async function sendStatsSummaryDMs(message, rows, sourceMessage) {
  const members = await getRoleMembers(message.guild);
  if (!members.length) {
    return {
      sent: 0,
      attempted: 0,
      reason: 'No guild members with HF_RESULT_ROLE_ID/HF_RESULT_ROLE_IDS were found.'
    };
  }

  const data = await loadHandFootballData().catch(() => ({ players: [] }));
  const embed = buildStatsSummaryEmbed(rows, sourceMessage, data.players || []);
  const dmMessages = [];

  for (const member of members) {
    const dm = await member.send({ embeds: [embed] }).catch(() => null);
    if (dm) dmMessages.push({ userId: member.id, messageId: dm.id });
  }

  if (sourceMessage?.id && dmMessages.length) {
    await HFStatsSummary.findOneAndUpdate(
      { guildId: message.guild.id, sourceMessageId: sourceMessage.id },
      { guildId: message.guild.id, sourceMessageId: sourceMessage.id, dmMessages },
      { upsert: true, returnDocument: 'after' }
    );
  }

  return {
    sent: dmMessages.length,
    attempted: members.length,
    reason: dmMessages.length < members.length
      ? 'Some members have DMs disabled or blocked the bot.'
      : ''
  };
}

async function deleteStatsSummaryDMs(message, sourceMessageId) {
  if (!sourceMessageId) return 0;
  const summary = await HFStatsSummary.findOne({
    guildId: message.guild.id,
    sourceMessageId
  }).lean();
  if (!summary) return 0;

  let deleted = 0;
  for (const item of summary.dmMessages || []) {
    const user = await message.client.users.fetch(item.userId).catch(() => null);
    const dm = await user?.createDM().catch(() => null);
    if (!dm) continue;
    const removed = await dm.messages.delete(item.messageId).then(() => true).catch(() => false);
    if (removed) deleted += 1;
  }

  await HFStatsSummary.deleteOne({ _id: summary._id });
  return deleted;
}

module.exports = {
  sendStatsSummaryDMs,
  deleteStatsSummaryDMs
};
