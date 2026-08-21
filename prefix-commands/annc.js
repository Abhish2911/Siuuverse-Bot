const E = require('../utils/emojis');
const {
  hasHFResultRole,
  findTeamByName,
  loadHandFootballData
} = require('../utils/handfootball');
const {
  parseAnnouncementTime,
  formatAnnouncementTime,
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

async function announce(message, timeText, teamText) {
  const scheduledAt = parseAnnouncementTime(timeText);
  if (!scheduledAt) return invalidTime(message);

  if (scheduledAt.getTime() <= Date.now()) {
    return message.reply(`${E.warning} The announcement time must be later today.`);
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

  const scheduled = scheduleAnnouncement(message.channel, scheduledAt, async () => {
    await setLocked(message.channel, false, 'HandFootball announcement time reached');
    await message.channel.send({
      content: roleMentions,
      allowedMentions: { roles: allowedRoleIds }
    });
    await message.channel.send(`🎮 Match announced for **${formatAnnouncementTime(scheduledAt)}**\n\nChannel Unlocked`);
  });

  if (!scheduled) {
    return message.reply(`${E.warning} That time has already passed today.`);
  }

  return message.reply([
    roleMentions,
    `🎮 Match announced for **${formatAnnouncementTime(scheduledAt)}**`,
    `${E.calendar} Channel will unlock at the announcement time.`
  ].join('\n'));
}

module.exports = {
  name: 'annc',
  aliases: ['announce'],

  async execute(message, args) {
    if (!hasHFResultRole(message)) {
      return message.reply(`${E.wrong} Only members with the configured HF result role can use this command.`);
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
