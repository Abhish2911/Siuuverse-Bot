const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { getData, updateData, appendData } = require('../utils/sheets');
const { invalidateSheetCache, sendAuditLog } = require('../utils/helpers');

const pendingReplace = new Map();

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

const normalize = v => String(v || '').trim().toLowerCase();

function cleanRows(rows) {
  return Array.isArray(rows)
    ? rows.slice(1).filter(row => row.some(cell => String(cell || '').trim()))
    : [];
}

function findTeamIdMapEntry(teamIdRows, teamName, shortName) {
  const rows = cleanRows(teamIdRows);

  return rows.find(row =>
    normalize(row[0]) === normalize(shortName) ||
    normalize(row[2]) === normalize(teamName)
  ) || null;
}

function getTeamIdFromMap(teamIdRows, teamName, shortName) {
  const entry = findTeamIdMapEntry(teamIdRows, teamName, shortName);
  return String(entry?.[1] || '').trim();
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

async function upsertTeamIdMap(oldTeam, payload) {
  const teamIdRows = await getData('Team_ID_Map!A:C').catch(() => []);
  const bodyRows = Array.isArray(teamIdRows) ? teamIdRows.slice(1) : [];
  const oldName = String(oldTeam?.[0] || '').trim();
  const oldShort = String(oldTeam?.[2] || '').trim();
  const existingTeamId = getTeamIdFromMap(teamIdRows, oldName, oldShort);
  const teamId = existingTeamId || generateNextTeamId(teamIdRows);

  const existingIndex = bodyRows.findIndex(row =>
    normalize(row[0]) === normalize(oldShort) ||
    normalize(row[2]) === normalize(oldName) ||
    normalize(row[1]) === normalize(teamId)
  );

  if (existingIndex === -1) {
    await appendData('Team_ID_Map!A:C', [[payload.short, teamId, payload.name]]);
    return teamId;
  }

  while (bodyRows[existingIndex].length < 3) bodyRows[existingIndex].push('');

  bodyRows[existingIndex][0] = payload.short;
  bodyRows[existingIndex][1] = teamId;
  bodyRows[existingIndex][2] = payload.name;

  await updateData('Team_ID_Map!A2:C', bodyRows);
  return teamId;
}

function buildReplaceSummary(oldTeam, payload, teamId = '') {
  return {
    oldName: String(oldTeam?.[0] || 'Unknown Team'),
    oldShort: String(oldTeam?.[2] || 'N/A'),
    newName: String(payload?.name || 'N/A'),
    newShort: String(payload?.short || 'N/A'),
    teamId: String(teamId || 'N/A'),
    captain: String(payload?.captain || 'N/A'),
    players: String(payload?.players || 'None'),
    users: String(payload?.users || 'None')
  };
}

function buildReplaceSelectDescription(payload, teamCount) {
  return (
    `🔁 **Select Team To Replace**\n` +
    `Choose which existing team should be updated with the new details.\n\n` +
    `🏷️ **New Name:** ${payload.name}\n` +
    `🔤 **New Short:** ${payload.short}\n` +
    `👑 **New Captain:** ${payload.captain}\n` +
    `📌 **Available Teams:** ${teamCount}`
  );
}

function buildReplacePreviewDescription(summary) {
  return (
    `⚠️ **Confirm Team Replacement**\n` +
    `Review the team update before saving it to the Teams sheet.\n\n` +
    `📉 **Old Team:** ${summary.oldName}\n` +
    `📈 **New Team:** ${summary.newName}\n` +
    `🔤 **Old Short:** ${summary.oldShort}\n` +
    `🔤 **New Short:** ${summary.newShort}\n` +
    `🆔 **Team ID:** ${summary.teamId}\n` +
    `👑 **Captain:** ${summary.captain}`
  );
}

function buildReplaceSuccessDescription(summary) {
  return (
    `🔁 **Team Updated Successfully**\n` +
    `The selected team entry was replaced successfully.\n\n` +
    `📉 **Old Team:** ${summary.oldName}\n` +
    `📈 **New Team:** ${summary.newName}\n` +
    `🔤 **Short Name:** ${summary.newShort}\n` +
    `🆔 **Team ID:** ${summary.teamId}\n` +
    `👑 **Captain:** ${summary.captain}\n` +
    `👥 **Players Updated:** ${summary.players
      .split(',')
      .map(p => p.trim())
      .filter(Boolean).length}`
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('replaceteam')
    .setDescription('Replace/update an existing team')
    .addStringOption(o => o.setName('name').setDescription('Team name').setRequired(true))
    .addStringOption(o => o.setName('players').setDescription('Players (comma separated)').setRequired(true))
    .addStringOption(o => o.setName('short').setDescription('Short name').setRequired(true))
    .addStringOption(o => o.setName('captain').setDescription('Captain ID').setRequired(true))
    .addStringOption(o => o.setName('users').setDescription('Other user IDs (comma separated)').setRequired(false)),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return { content: '🚫 Admin only command.' };
    }

    const payload = {
      name: String(interaction.options.getString('name') || '').trim(),
      players: String(interaction.options.getString('players') || '').trim(),
      short: String(interaction.options.getString('short') || '').trim().toUpperCase(),
      captain: String(interaction.options.getString('captain') || '').trim(),
      users: String(interaction.options.getString('users') || '').trim()
    };

    const teams = await getData('Teams!A:F');
    const rows = Array.isArray(teams) ? teams.slice(1).filter(r => r[0]) : [];

    if (!rows.length) {
      return { content: '❌ No teams found.' };
    }

    pendingReplace.set(interaction.user.id, { payload, ts: Date.now() });

    const options = rows.slice(0, 25).map((r, i) => ({
      label: String(r[0]).slice(0, 100),
      value: String(i),
      description: `Short: ${String(r[2] || 'N/A').slice(0, 90)}`
    }));

    const embed = new EmbedBuilder()
      .setTitle('🔁 Select Team To Replace')
      .setDescription(buildReplaceSelectDescription(payload, rows.length))
      .addFields(
        { name: '🏷️ New Name', value: payload.name, inline: true },
        { name: '🔤 New Short', value: payload.short, inline: true },
        { name: '👑 New Captain', value: payload.captain, inline: true }
      )
      .setColor(0x3498DB)
      .setFooter({ text: 'Replace Team • Select an existing team to continue' });

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('replaceteam_select')
        .setPlaceholder('Select team')
        .addOptions(options)
    );

    return { embeds: [embed], components: [row] };
  },

  async selectHandler(interaction) {
    if (!isAdmin(interaction)) {
      return { content: '🚫 Admin only command.', components: [] };
    }

    const pending = pendingReplace.get(interaction.user.id);
    if (!pending) {
      return { content: '❌ Replace expired. Run /replaceteam again.', components: [] };
    }

    const [teams, teamIdRows] = await Promise.all([
      getData('Teams!A:F'),
      getData('Team_ID_Map!A:C').catch(() => [])
    ]);
    const rows = Array.isArray(teams) ? teams.slice(1).filter(r => r[0]) : [];
    const idx = Number(interaction.values[0]);
    const team = Number.isInteger(idx) ? rows[idx] : null;

    if (!team) {
      return { content: '❌ Team not found.', components: [] };
    }

    const existingTeamId = getTeamIdFromMap(teamIdRows, team[0], team[2]);
    const summary = buildReplaceSummary(team, pending.payload, existingTeamId || 'Will be generated on confirm');

    const embed = new EmbedBuilder()
      .setTitle('⚠️ Confirm Replace')
      .setDescription(buildReplacePreviewDescription(summary))
      .addFields(
        { name: '👥 New Players', value: summary.players, inline: false },
        { name: '🆔 Other User IDs', value: summary.users || 'None', inline: false },
        { name: '🆔 Team ID', value: summary.teamId, inline: true }
      )
      .setColor(0xE67E22)
      .setFooter({ text: 'Replace Team • Confirm to overwrite team details' });

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`replaceteam_confirm_${idx}`)
        .setLabel('✅ Yes, Replace')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('replaceteam_cancel')
        .setLabel('❌ Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [buttons] };
  },

  async buttonHandler(interaction, action, value) {
    if (!isAdmin(interaction)) {
      return { content: '🚫 Admin only command.', components: [] };
    }

    if (action === 'cancel') {
      pendingReplace.delete(interaction.user.id);
      return {
        embeds: [
          new EmbedBuilder()
            .setTitle('❎ Replace Cancelled')
            .setDescription('No changes were made.')
            .setColor(0x95A5A6)
        ],
        components: []
      };
    }

    const pending = pendingReplace.get(interaction.user.id);
    if (!pending) {
      return { content: '❌ Replace expired. Run /replaceteam again.', components: [] };
    }

    const teams = await getData('Teams!A:F');
    const rows = Array.isArray(teams) ? teams.slice(1) : [];

    const idx = Number(value);
    const filtered = rows.filter(r => r[0]);
    const target = Number.isInteger(idx) ? filtered[idx] : null;

    if (!target) {
      return { content: '❌ Team not found.', components: [] };
    }

    const realIndex = rows.findIndex(r => normalize(r[0]) === normalize(target[0]));
    if (realIndex === -1) {
      return { content: '❌ Team not found.', components: [] };
    }

    const p = pending.payload;

    while (rows[realIndex].length < 6) rows[realIndex].push('');

    const prevRow = [...rows[realIndex]];
    const teamId = await upsertTeamIdMap(prevRow, p);
    const prevSummary = buildReplaceSummary(prevRow, p, teamId);

    rows[realIndex][0] = p.name;
    rows[realIndex][1] = p.players;
    rows[realIndex][2] = p.short;
    rows[realIndex][4] = p.captain;
    rows[realIndex][5] = p.users;

    await interaction.message.edit({
      embeds: [
        new EmbedBuilder()
          .setTitle('⏳ Updating Team...')
          .setDescription(`Updating **${prevRow[0]}** → **${p.name}**`)
          .setColor(0xE67E22)
      ],
      components: []
    });

    await updateData('Teams!A2:F', rows);
    invalidateSheetCache(['Teams!', 'Team_ID_Map!']);
    pendingReplace.delete(interaction.user.id);

    sendAuditLog(interaction, {
      title: '🔁 Team Replaced',
      description: `**${prevRow[0]}** → **${p.name}**`,
      color: 0x3498DB,
      fields: [
        { name: 'Old Short', value: String(prevRow[2] || 'N/A'), inline: true },
        { name: 'New Short', value: p.short, inline: true },
        { name: 'Team ID', value: teamId || 'N/A', inline: true },
        { name: 'Captain', value: p.captain, inline: true }
      ]
    });

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle('🔁 Team Updated')
          .setDescription(buildReplaceSuccessDescription(prevSummary))
          .addFields(
            { name: '🔤 Short', value: p.short, inline: true },
            { name: '🆔 Team ID', value: teamId || 'N/A', inline: true },
            { name: '👑 Captain', value: p.captain, inline: true },
            { name: '👥 Players', value: p.players, inline: false },
            { name: '🆔 Other User IDs', value: p.users || 'None', inline: false }
          )
          .setColor(0x2ECC71)
          .setFooter({ text: 'Replace Team • Teams + Team_ID_Map updated successfully' })
      ],
      components: []
    };
  }
};