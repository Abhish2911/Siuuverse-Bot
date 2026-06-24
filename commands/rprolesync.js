const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { getData } = require('../utils/sheets');
const emojis = require('../utils/emojis');

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
      const club = String(row[0] || '').trim().toUpperCase();
      const roleId = String(row[1] || '').trim();

      if (club && roleId) {
        roleMap.set(club, roleId);
      }
    }

    const guild = interaction.guild;
    let updated = 0;
    let missingRoles = 0;
    let missingMembers = 0;

    await interaction.editReply({
      content: `${emojis.loading || '⏳'} Syncing RP club roles...`
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

      const roleId = roleMap.get(clubName.toUpperCase());

      if (!roleId) {
        missingRoles++;
        continue;
      }

      const role = guild.roles.cache.get(roleId);

      if (!role) {
        missingRoles++;
        continue;
      }

      if (!member.roles.cache.has(role.id)) {
        await member.roles.add(role).catch(() => null);
        updated++;
      }
    }

    const embed = new EmbedBuilder()
      .setTitle(`${emojis.correct} RP Role Sync Complete`)
      .setDescription([
        `${emojis.team} Club roles synced successfully.`,
        '',
        `${emojis.correct} Users Updated: **${updated}**`,
        `${emojis.missing} Missing Members: **${missingMembers}**`,
        `${emojis.warning} Missing Club Roles: **${missingRoles}**`
      ].join('\n'))
      .setFooter({ text: 'Role Synchronization Finished' })
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed]
    });
  }
};