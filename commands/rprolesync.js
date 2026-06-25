const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { getData } = require('../utils/sheets');
const emojis = require('../utils/emojis');

function normalizeClubName(club) {
  const value = String(club || '').trim().toUpperCase();

  if (['FC BARCELONA', 'BARCELONA', 'BARCA'].includes(value)) {
    return 'FC BARCELONA';
  }

  if (['MANCHESTER CITY', 'MAN CITY', 'CITY'].includes(value)) {
    return 'MANCHESTER CITY';
  }

  if (['MANCHESTER UNITED', 'MAN UNITED', 'MAN UTD', 'UNITED'].includes(value)) {
    return 'MANCHESTER UNITED';
  }

  if (['REAL MADRID', 'MADRID'].includes(value)) {
    return 'REAL MADRID';
  }

  return value;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rprolesync')
    .setDescription('Sync RP club roles to players.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.editReply({
        content: `${emojis.wrong} You need the Manage Roles permission to use this command.`
      });
    }
    const rows = await getData('Player_Data!A:P', {
      spreadsheetId: process.env.RP_SHEET_ID
    });

    const clubRows = await getData('Clubs!A:B', {
      spreadsheetId: process.env.RP_SHEET_ID
    });

    const roleMap = new Map();

    for (const row of clubRows.slice(1)) {
      const club = normalizeClubName(row[0]);
      const roleId = String(row[1] || '').trim();

      if (club && roleId) {
        roleMap.set(club, roleId);
      }
    }

    const guild = interaction.guild;
    let updated = 0;
    let missingRoles = 0;
    let missingMembers = 0;

    const clubStats = new Map();

    for (const row of rows.slice(1)) {
      const clubName = String(row[5] || '').trim();
      if (!clubName) continue;

      if (!clubStats.has(clubName)) {
        clubStats.set(clubName, { total: 0, synced: 0 });
      }

      clubStats.get(clubName).total++;
    }

    const progressEmbed = new EmbedBuilder()
      .setTitle(`${emojis.loading || '⏳'} RP Role Sync In Progress`)
      .setDescription(
        [...clubStats.entries()]
          .map(([club, stats]) => `${emojis.loading || '⏳'} ${club} — **0/${stats.total}**`)
          .join('\n')
      )
      .setTimestamp();

    await interaction.editReply({
      embeds: [progressEmbed]
    }).catch(() => null);

    for (const row of rows.slice(1)) {
      const userId = String(row[0] || '').trim();
      const clubName = String(row[5] || '').trim();

      if (!userId || !clubName) continue;

      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        missingMembers++;
        continue;
      }

      const roleId = roleMap.get(normalizeClubName(clubName));

      if (!roleId) {
        missingRoles++;
        continue;
      }

      const role = guild.roles.cache.get(roleId);

      if (!role) {
        missingRoles++;
        continue;
      }

      let syncedSuccessfully = member.roles.cache.has(role.id);

      if (!syncedSuccessfully) {
        try {
          await member.roles.add(role);
          updated++;
          syncedSuccessfully = true;
        } catch {
          syncedSuccessfully = false;
        }
      }

      if (syncedSuccessfully) {
        const stat = clubStats.get(clubName);
        if (stat) {
          stat.synced++;
        }
      }

      const totalProcessed = [...clubStats.values()]
        .reduce((sum, s) => sum + s.synced, 0);

      if (totalProcessed % 3 === 0) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle(`${emojis.loading || '⏳'} RP Role Sync In Progress`)
              .setDescription(
                [...clubStats.entries()]
                  .map(([club, stats]) =>
                    `${stats.synced >= stats.total ? (emojis.correct || '✅') : (emojis.loading || '⏳')} ${club} — **${stats.synced}/${stats.total}**`
                  )
                  .join('\n')
              )
              .setTimestamp()
          ]
        }).catch(() => null);
      }
    }

    const embed = new EmbedBuilder()
      .setTitle(`${emojis.correct} RP Role Sync Complete`)
      .setDescription([
        `${emojis.team} Club roles synced successfully.`,
        '',
        ...[...clubStats.entries()].map(([club, stats]) =>
          `${emojis.correct} ${club} — **${stats.synced}/${stats.total}**`
        ),
        '',
        `${emojis.correct} Users Updated: **${updated}**`,
        `${emojis.missing} Missing Members: **${missingMembers}**`,
        `${emojis.warning} Missing Club Roles: **${missingRoles}**`
      ].join('\n'))
      .setFooter({ text: 'Role Synchronization Finished' })
      .setTimestamp();

    await interaction.editReply({
      content: null,
      embeds: [embed]
    });
  }
};
