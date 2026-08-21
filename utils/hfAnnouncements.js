const { PermissionFlagsBits } = require('discord.js');
const mongoose = require('mongoose');
const HFAnnouncementSchedule = require('../models/HFAnnouncementSchedule');

const announcementTimers = new Map();

function getConfiguredLockRoleId() {
  return String(
    process.env.HF_LOCK_ROLE_ID ||
    process.env.HF_CHANNEL_LOCK_ROLE_ID ||
    ''
  ).replace(/[<@&>]/g, '').trim();
}

function getConfiguredResultRoleIds() {
  return [
    ...String(process.env.HF_RESULT_ROLE_ID || '').split(','),
    ...String(process.env.HF_RESULT_ROLE_IDS || '').split(',')
  ].map(value => value.replace(/[<@&>]/g, '').trim()).filter(Boolean);
}

function getHFTimezone() {
  const timezone = String(process.env.HF_TIMEZONE || 'UTC').trim() || 'UTC';

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return timezone;
  } catch {
    console.warn(`⚠️ Invalid HF_TIMEZONE "${timezone}". Falling back to UTC.`);
    return 'UTC';
  }
}

function getZonedParts(date, timeZone) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date)
      .filter(part => ['year', 'month', 'day', 'hour', 'minute'].includes(part.type))
      .map(part => [part.type, Number(part.value)])
  );
}

function getTimezoneOffsetMs(date, timeZone) {
  const parts = getZonedParts(date, timeZone);
  const zonedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    0
  );

  return zonedAsUtc - date.getTime();
}

function createDateInTimezone(year, month, day, hour, minute, timeZone) {
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const firstGuess = new Date(wallClockAsUtc);
  const firstOffset = getTimezoneOffsetMs(firstGuess, timeZone);
  const correctedGuess = new Date(wallClockAsUtc - firstOffset);
  const correctedOffset = getTimezoneOffsetMs(correctedGuess, timeZone);

  return new Date(wallClockAsUtc - correctedOffset);
}

function canManageHFChannel(message) {
  const resultRoleIds = getConfiguredResultRoleIds();
  const hasResultRole = resultRoleIds.some(roleId => message.member?.roles?.cache?.has(roleId));
  const canManageChannel = message.channel
    ?.permissionsFor?.(message.member)
    ?.has(PermissionFlagsBits.ManageChannels);

  return hasResultRole && canManageChannel;
}

function parseAnnouncementTime(value, now = new Date()) {
  const input = String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
  let match = input.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/);

  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3];

  if (minute > 59) return null;

  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'AM' && hour === 12) hour = 0;
    if (meridiem === 'PM' && hour !== 12) hour += 12;
  } else if (hour > 23) {
    return null;
  }

  const timezone = getHFTimezone();
  const today = getZonedParts(now, timezone);

  return createDateInTimezone(
    today.year,
    today.month,
    today.day,
    hour,
    minute,
    timezone
  );
}

function formatAnnouncementTime(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: getHFTimezone(),
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(date);
}

function formatAnnouncementTimestamp(date) {
  return `<t:${Math.floor(new Date(date).getTime() / 1000)}:F>`;
}

function scheduleAnnouncement(channel, scheduledAt, callback) {
  const key = channel.id;
  const previous = announcementTimers.get(key);
  if (previous) clearTimeout(previous);

  const delay = Math.max(0, scheduledAt.getTime() - Date.now());

  const timer = setTimeout(async () => {
    announcementTimers.delete(key);
    try {
      await callback();
    } catch (error) {
      console.error(`❌ Scheduled HandFootball announcement failed in ${key}:`, error);
    }
  }, delay);

  announcementTimers.set(key, timer);
  return true;
}

function cancelScheduledAnnouncement(channelId) {
  const timer = announcementTimers.get(channelId);
  if (!timer) return false;

  clearTimeout(timer);
  announcementTimers.delete(channelId);
  return true;
}

function hasAnnouncementPersistence() {
  return mongoose.connection.readyState === 1;
}

async function getStoredAnnouncement(guildId, channelId) {
  if (!hasAnnouncementPersistence()) return null;

  return HFAnnouncementSchedule.findOne({ guildId, channelId });
}

async function saveStoredAnnouncement(data) {
  if (!hasAnnouncementPersistence()) {
    throw new Error('MongoDB is not connected, so this announcement cannot be saved.');
  }

  return HFAnnouncementSchedule.findOneAndUpdate(
    { guildId: data.guildId, channelId: data.channelId },
    { $set: data },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function deleteStoredAnnouncement(guildId, channelId) {
  if (!hasAnnouncementPersistence()) return false;

  await HFAnnouncementSchedule.deleteOne({ guildId, channelId });
  return true;
}

async function completeAnnouncement(channel, scheduledAt, roleIds) {
  const allowedRoleIds = [...new Set((roleIds || []).filter(Boolean))];
  const roleMentions = allowedRoleIds.map(roleId => `<@&${roleId}>`).join(' vs ');

  let unlockError = null;
  try {
    await setLocked(channel, false, 'HandFootball announcement time reached');
  } catch (error) {
    unlockError = error;
    console.error(`❌ Failed to unlock HandFootball announcement channel ${channel.id}:`, error);
  }

  if (roleMentions) {
    try {
      await channel.send({
        content: roleMentions,
        allowedMentions: { roles: allowedRoleIds }
      });
    } catch (error) {
      console.error(`❌ Failed to tag HandFootball announcement teams in ${channel.id}:`, error);
    }
  }

  const statusLine = unlockError
    ? `Channel unlock failed: ${unlockError.message}`
    : 'Channel Unlocked';
  await channel.send(`🎮 Match announced for **${formatAnnouncementTimestamp(scheduledAt)}**\n\n${statusLine}`);
  await deleteStoredAnnouncement(channel.guild.id, channel.id);
}

function scheduleStoredAnnouncement(client, record) {
  const guild = client.guilds.cache.get(record.guildId);
  if (!guild) return false;

  const channel = guild.channels.cache.get(record.channelId);
  if (!channel || typeof channel.send !== 'function') return false;

  return scheduleAnnouncement(channel, new Date(record.scheduledAt), async () => {
    await completeAnnouncement(channel, new Date(record.scheduledAt), record.roleIds);
  });
}

async function restoreStoredAnnouncements(client) {
  if (!hasAnnouncementPersistence()) return 0;

  const records = await HFAnnouncementSchedule.find({});
  let restored = 0;

  for (const record of records) {
    if (scheduleStoredAnnouncement(client, record)) {
      restored += 1;
    }
  }

  return restored;
}

async function setLocked(channel, locked, reason) {
  const roleId = getConfiguredLockRoleId();
  if (!roleId) {
    throw new Error('HF_LOCK_ROLE_ID is missing in .env');
  }

  const role = channel.guild.roles.cache.get(roleId)
    || await channel.guild.roles.fetch(roleId).catch(() => null);

  if (!role) throw new Error(`The configured lock role (${roleId}) was not found.`);

  const botMember = channel.guild.members.me;
  if (botMember && !botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
    throw new Error('I need Manage Channels permission to lock this channel.');
  }

  await channel.permissionOverwrites.edit(role, {
    SendMessages: locked ? false : true
  }, { reason });

  return role;
}

module.exports = {
  getConfiguredLockRoleId,
  getConfiguredResultRoleIds,
  canManageHFChannel,
  parseAnnouncementTime,
  formatAnnouncementTime,
  formatAnnouncementTimestamp,
  scheduleAnnouncement,
  cancelScheduledAnnouncement,
  hasAnnouncementPersistence,
  getStoredAnnouncement,
  saveStoredAnnouncement,
  deleteStoredAnnouncement,
  completeAnnouncement,
  scheduleStoredAnnouncement,
  restoreStoredAnnouncements,
  setLocked
};
