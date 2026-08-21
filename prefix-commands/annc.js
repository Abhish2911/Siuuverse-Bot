const E = require('../utils/emojis');
const {
  hasHFResultRole,
  findTeamByName,
  loadHandFootballData
} = require('../utils/handfootball');
const {
  parseAnnouncementTime,
  formatAnnouncementTime,
  formatAnnouncementTimestamp,
  hasAnnouncementPersistence,
  getStoredAnnouncement,
  saveStoredAnnouncement,
  deleteStoredAnnouncement,
  cancelScheduledAnnouncement,
  completeAnnouncement,
  scheduleAnnouncement,
  setLocked
} = require('../utils/hfAnnouncements');

const TIME_FORMATS = ['2:30 PM', '14:30', '2 PM', '2:30'];

function invalidTime(message) {
  return message.reply([
    `${E.warning} Invalid time format.`,
    `Please use formats like: ${TIME_FORMATS.map(value => `\`${value}\``).join(', ')}.`
  ].join('\n'));
}

async function removeSetupMessages(messages) {
  await Promise.all(messages.map(setupMessage => (
    setupMessage?.delete?.().catch(() => null)
  )));
}

async function confirmOverwrite(message, existing) {
  const dateText = `${formatAnnouncementTime(new Date(existing.scheduledAt))} • ${formatAnnouncementTimestamp(existing.scheduledAt)}`;
  const prompt = await message.reply(
    `${E.warning} This channel already has an announcement scheduled for **${dateText}**. Type \`yes\` to replace it or \`no\` to keep it.`
  );

  const response = await new Promise(resolve => {
    const collector = message.channel.createMessageCollector({
      filter: candidate => candidate.author.id === message.author.id,
      time: 30000,
      max: 1
    });

    collector.on('collect', candidate => {
      resolve({ confirmed: /^(yes|y|confirm)$/i.test(candidate.content.trim()), message: candidate });
      collector.stop('answered');
    });

    collector.on('end', (_, reason) => {
      if (reason === 'time') resolve({ confirmed: false, message: null });
    });
  });

  await removeSetupMessages([prompt, response.message]);
  return response.confirmed;
}

async function cancelAnnouncement(message) {
  if (!hasAnnouncementPersistence()) {
    return message.reply(`${E.warning} MongoDB is not connected, so there is no persistent announcement to cancel.`);
  }

  const existing = await getStoredAnnouncement(message.guild.id, message.channel.id);
  if (!existing) {
    return message.reply(`${E.warning} There is no scheduled announcement in this channel.`);
  }

  cancelScheduledAnnouncement(message.channel.id);
  await deleteStoredAnnouncement(message.guild.id, message.channel.id);
  await setLocked(message.channel, false, `Cancelled by ${message.author.tag}`).catch(() => null);
  return message.reply(`#${message.channel.name} announcement cancelled.`);
}

async function announce(message, timeText, teamText) {
  const scheduledAt = parseAnnouncementTime(timeText);
  if (!scheduledAt) return invalidTime(message);

  if (scheduledAt.getTime() <= Date.now()) {
    return message.reply(`${E.warning} The announcement time must be later today.`);
  }

  if (!hasAnnouncementPersistence()) {
    return message.reply(`${E.warning} MongoDB is not connected, so scheduled announcements cannot be saved.`);
  }

  const existing = await getStoredAnnouncement(message.guild.id, message.channel.id);
  if (existing) {
    const shouldReplace = await confirmOverwrite(message, existing);
    if (!shouldReplace) {
      return message.reply(`${E.warning} Existing announcement left unchanged.`);
    }

    cancelScheduledAnnouncement(message.channel.id);
    await deleteStoredAnnouncement(message.guild.id, message.channel.id);
  }

  const teamNames = teamText.split(/\s+vs\.?\s+/i).map(value => value.trim()).filter(Boolean);
  if (teamNames.length !== 2) {
    return message.reply(`${E.profile} Enter both teams in this format: \`Team One vs Team Two\`.`);
  }

  const data = await loadHandFootballData();
  const teams = teamNames.map(teamName => findTeamByName(data, teamName));
  const missingTeamIndex = teams.findIndex(team => !team);
  if (missingTeamIndex !== -1) {
    return message.reply(`${E.missing} HandFootball team not found: **${teamNames[missingTeamIndex]}**.`);
  }

  const missingRoleTeam = teams.find(team => !team.roleId);
  if (missingRoleTeam) {
    return message.reply(`${E.missing} **${missingRoleTeam.team}** does not have a team role ID in the HF sheet.`);
  }

  const roles = [];
  for (const team of teams) {
    const role = message.guild.roles.cache.get(team.roleId)
      || await message.guild.roles.fetch(team.roleId).catch(() => null);
    if (!role) {
      return message.reply(`${E.missing} The team role for **${team.team}** was not found in this server.`);
    }
    if (!roles.some(existingRole => existingRole.id === role.id)) roles.push(role);
  }

  const roleMentions = roles.map(role => `<@&${role.id}>`).join(' vs ');
  const allowedRoleIds = roles.map(role => role.id);

  try {
    // Scheduling an announcement also locks this channel until the match time.
    await setLocked(message.channel, true, `Scheduled by ${message.author.tag}`);
    await saveStoredAnnouncement({
      guildId: message.guild.id,
      channelId: message.channel.id,
      scheduledAt,
      teamNames: teams.map(team => team.team),
      roleIds: allowedRoleIds,
      createdBy: message.author.id
    });
    scheduleAnnouncement(message.channel, scheduledAt, async () => {
      await completeAnnouncement(message.channel, scheduledAt, allowedRoleIds);
    });
  } catch (error) {
    await setLocked(message.channel, false, 'Announcement scheduling rollback').catch(() => null);
    await deleteStoredAnnouncement(message.guild.id, message.channel.id).catch(() => null);
    return message.reply(`${E.wrong} Could not schedule the announcement: ${error.message}`);
  }

  return message.channel.send({
    content: [
      roleMentions,
      `🎮 Match announced for **${formatAnnouncementTimestamp(scheduledAt)}**`,
      `${E.calendar} Channel will unlock at the announcement time.`
    ].join('\n'),
    allowedMentions: { roles: allowedRoleIds }
  });
}

module.exports = {
  name: 'annc',
  aliases: ['announce'],

  async execute(message, args) {
    if (!hasHFResultRole(message)) {
      return message.reply(`${E.wrong} Only members with the configured HF result role can use this command.`);
    }

    if (args[0]?.toLowerCase() === 'cancel') {
      return cancelAnnouncement(message);
    }

    if (args.length) {
      const hasMeridiem = /^(AM|PM)$/i.test(args[1] || '');
      const timeArgCount = hasMeridiem ? 2 : 1;
      const timeText = args.slice(0, timeArgCount).join(' ');
      const teamText = args.slice(timeArgCount).join(' ').trim();
      if (!teamText) return message.reply(`${E.profile} Usage: \`+annc 8:15 PM Team One vs Team Two\``);
      return announce(message, timeText, teamText);
    }

    const prompt = await message.reply(`${E.calendar} What time should the match be announced? Example: \`8:15 PM\``);
    const setupMessages = [prompt];
    const collector = message.channel.createMessageCollector({
      filter: response => response.author.id === message.author.id,
      time: 60000,
      max: 2
    });
    let step = 0;
    let timeText = '';

    collector.on('collect', async response => {
      if (step === 0) {
        timeText = response.content.trim();
        setupMessages.push(response);
        if (!parseAnnouncementTime(timeText)) {
          await invalidTime(message);
          collector.stop('invalid-time');
          await removeSetupMessages(setupMessages);
          return;
        }
        step = 1;
        const teamPrompt = await message.channel.send(`${E.team} Enter both HandFootball team names, for example: \`Team One vs Team Two\``);
        setupMessages.push(teamPrompt);
        return;
      }

      setupMessages.push(response);
      collector.stop('complete');
      await announce(message, timeText, response.content.trim());
      await removeSetupMessages(setupMessages);
    });

    collector.on('end', (_, reason) => {
      if (reason === 'time') {
        removeSetupMessages(setupMessages);
      }
    });
  }
};
