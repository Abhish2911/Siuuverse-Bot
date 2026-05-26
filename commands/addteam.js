const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { appendData, getData } = require('../utils/sheets');
const { formatList, invalidateSheetCache, sendAuditLog } = require('../utils/helpers');

function isAdmin(interaction) {
  const ownerIds = String(process.env.OWNER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  const adminRoleIds = String(process.env.ADMIN_ROLE_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  const isOwner =
    ownerIds.includes(interaction.user.id) ||
    interaction.guild?.ownerId === interaction.user.id;

  const hasRole = interaction.member?.roles?.cache?.some(role =>
    adminRoleIds.includes(role.id)
  );

  return isOwner || hasRole;
}

const normalize = (value) => String(value || '').trim().toLowerCase();
const isDiscordId = (value) => /^\d{17,20}$/.test(String(value || '').trim());

function cleanRows(rows) {
  return Array.isArray(rows)
    ? rows.slice(1).filter(row => row.some(cell => String(cell || '').trim()))
    : [];
}

function generateNextTeamId(teamIdRows) {
  const ids = cleanRows(teamIdRows)
    .map(row => String(row[1] || '').trim())
    .filter(Boolean);

  const maxNumber = ids.reduce((max, id) => {
    const match = id.match(/^T(\d+)$/i);
    if (!match) return max;
    return Math.max(max, Number(match[1]));
  }, 0);

  return `T${String(maxNumber + 1).padStart(3, '0')}`;
}

function buildAddTeamSummary(name, short, players, captain, users, teamId) {
  const playerCount = players
    ? players.split(',').map(p => p.trim()).filter(Boolean).length
    : 0;

  const userCount = users
    ? users.split(',').map(id => id.trim()).filter(Boolean).length
    : 0;

  return {
    name,
    short,
    teamId,
    players: players || 'None',
    captain: captain || 'N/A',
    users: users || 'None',
    playerCount,
    userCount
  };
}

function buildAddTeamDescription(summary) {
  return (
    `✅ **Team Added Successfully**\n` +
    `The new team was added to the Teams sheet.\n\n` +
    `🏷️ **Team:** ${summary.name}\n` +
    `🔤 **Short Name:** ${summary.short}\n` +
    `🆔 **Team ID:** ${summary.teamId}\n` +
    `👑 **Captain ID:** ${summary.captain}\n` +
    `👥 **Players Added:** ${summary.playerCount}\n` +
    `🆔 **Other User IDs:** ${summary.userCount}`
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addteam')
    .setDescription('Add a team')
    .addStringOption(opt =>
      opt.setName('name').setDescription('Team name').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('players').setDescription('Comma-separated player names').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('short').setDescription('Team short name').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('captain').setDescription('Captain Discord user ID').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('users').setDescription('Other squad Discord user IDs separated by commas').setRequired(false)
    ),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return { content: '🚫 Admin only command.' };
    }

    const name = String(interaction.options.getString('name') || '').trim();
    const short = String(interaction.options.getString('short') || '').trim().toUpperCase();
    const playersRaw = interaction.options.getString('players') || '';
    const captain = String(interaction.options.getString('captain') || '').trim();
    const usersRaw = interaction.options.getString('users') || '';

    const players = formatList(playersRaw);
    const users = formatList(usersRaw);

    const playerList = players
      .split(',')
      .map(p => p.trim())
      .filter(Boolean);

    const userList = users
      .split(',')
      .map(id => id.trim())
      .filter(Boolean);

    if (!name) {
      return { content: '❌ Team name is required.' };
    }

    if (!short || short.length > 10) {
      return { content: '❌ Team short name is required and should be 10 characters or less.' };
    }

    if (!playerList.length) {
      return { content: '❌ Add at least one player.' };
    }

    if (!isDiscordId(captain)) {
      return { content: '❌ Captain must be a valid Discord user ID.' };
    }

    if (userList.some(id => !isDiscordId(id))) {
      return { content: '❌ Every squad user ID must be a valid Discord user ID.' };
    }

    if (playerList.length > 1 && userList.length !== playerList.length - 1) {
      return {
        content: `❌ Player/User mismatch. You entered ${playerList.length} players, so users field must contain ${playerList.length - 1} other squad ID(s).`
      };
    }

    if (playerList.length === 1 && userList.length > 0) {
      return { content: '❌ Single-player team should not have extra squad user IDs.' };
    }

    const [teams, teamIdRows] = await Promise.all([
      getData('Teams!A:F'),
      getData('Team_ID_Map!A:C').catch(() => [])
    ]);
    const rows = Array.isArray(teams) ? teams.slice(1).filter(r => r[0] || r[2]) : [];

    const duplicateName = rows.find(r => normalize(r[0]) === normalize(name));
    if (duplicateName) {
      return { content: `❌ Team name already exists: **${duplicateName[0]}**` };
    }

    const duplicateShort = rows.find(r => normalize(r[2]) === normalize(short));
    if (duplicateShort) {
      return { content: `❌ Team short name already exists: **${duplicateShort[2]}**` };
    }

    const teamIdMapRows = cleanRows(teamIdRows);

    const duplicateMapShort = teamIdMapRows.find(row => normalize(row[0]) === normalize(short));
    if (duplicateMapShort) {
      return { content: `❌ Team short name already exists in Team_ID_Map: **${duplicateMapShort[0]}**` };
    }

    const duplicateMapName = teamIdMapRows.find(row => normalize(row[2]) === normalize(name));
    if (duplicateMapName) {
      return { content: `❌ Team name already exists in Team_ID_Map: **${duplicateMapName[2]}**` };
    }

    const teamId = generateNextTeamId(teamIdRows);

    const duplicateCaptain = rows.find(r => String(r[4] || '').trim() === captain);
    if (duplicateCaptain) {
      return { content: `❌ This captain ID is already linked to **${duplicateCaptain[0]}**.` };
    }

    const duplicateUser = rows.find(r => {
      const existingUsers = String(r[5] || '')
        .split(',')
        .map(id => id.trim())
        .filter(Boolean);
      return userList.some(id => existingUsers.includes(id));
    });

    if (duplicateUser) {
      return { content: `❌ One of those squad user IDs is already linked to **${duplicateUser[0]}**.` };
    }

    await appendData('Teams!A:F', [[name, players, short, '', captain, users]]);
    await appendData('Team_ID_Map!A:C', [[short, teamId, name]]);
    invalidateSheetCache(['Teams!', 'Team_ID_Map!']);

    sendAuditLog(interaction, {
      title: '✅ Team Added',
      description: `**${name}** was added to the Teams sheet.`,
      color: 0x2ECC71,
      fields: [
        { name: '🔤 Short Name', value: short || 'N/A', inline: true },
        { name: '🆔 Team ID', value: teamId || 'N/A', inline: true },
        { name: '👑 Captain ID', value: captain || 'N/A', inline: true },
        { name: '👥 Players', value: players || 'None', inline: false },
        { name: '🆔 Other Squad User IDs', value: users || 'None', inline: false }
      ]
    });

    const summary = buildAddTeamSummary(name, short, players, captain, users, teamId);

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle('✅ Team Added')
          .setDescription(buildAddTeamDescription(summary))
          .addFields(
            { name: '🏷️ Team', value: `**${summary.name}**`, inline: true },
            { name: '🔤 Short Name', value: `**${summary.short}**`, inline: true },
            { name: '🆔 Team ID', value: `**${summary.teamId}**`, inline: true },
            { name: '👥 Players', value: summary.players, inline: false },
            { name: '👑 Captain ID', value: summary.captain, inline: true },
            { name: '🆔 Other Squad User IDs', value: summary.users, inline: false }
          )
          .setColor(0x2ECC71)
          .setFooter({ text: 'Add Team • Team added successfully to Teams + Team_ID_Map' })
      ]
    };
  }
};