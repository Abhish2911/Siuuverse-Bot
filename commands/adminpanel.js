const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder
} = require('discord.js');
const { getData } = require('../utils/sheets');
const { sendAuditLog } = require('../utils/helpers');
const E = require('../utils/emojis');
const { refreshLiveStandings } = require('../utils/liveStandings');

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

function buildAdminPanelSummary() {
  return {
    sections: 4,
    backups: 'Teams / Fixtures',
    reset: 'Manual safe reset only',
    live: 'COOP live standings refresh',
    tools: 'Team management shortcuts'
  };
}

function buildAdminPanelDescription(summary) {
  return (
    `${E.lock} **SiuuVerse Admin Dashboard**\n` +
    `Quick owner/admin actions for backups, live tools, reset help and team management.\n\n` +
    `💾 **Backups:** ${summary.backups}\n` +
    `♻️ **Reset:** ${summary.reset}\n` +
    `🏆 **Live:** ${summary.live}\n` +
    `👥 **Tools:** ${summary.tools}\n` +
    `📌 **Sections:** ${summary.sections}`
  );
}

function buildBackupDescription(label, rowsLength, filename) {
  return (
    `💾 **${label} Backup Ready**\n` +
    `A backup file was created successfully from the admin panel.\n\n` +
    `📄 **Rows:** ${rowsLength}\n` +
    `🗂️ **File:** ${filename}\n` +
    `🔒 **Action:** Download and store this backup safely.`
  );
}

function buildLiveRefreshDescription(status) {
  return (
    `🏆 **Live Standings Refresh**\n` +
    `The configured COOP live standings message was refreshed from the admin panel.\n\n` +
    `📌 **Status:** ${status}`
  );
}

function buildPanelEmbed() {
  const summary = buildAdminPanelSummary();

  return new EmbedBuilder()
    .setTitle(`${E.lock} SiuuVerse Admin Panel`)
    .setDescription(buildAdminPanelDescription(summary))
    .addFields(
      {
        name: `${E.save} Backup`,
        value: '`Teams` and `Fixtures` backup files',
        inline: false
      },
      {
        name: `${E.fire} Reset`,
        value: 'Shows safe reset commands. Reset still requires `CONFIRM`.',
        inline: false
      },
      {
        name: `${E.trophy_animated || E.PL || E.Stats} Live Standings`,
        value: 'Refresh the configured live standings message.',
        inline: false
      },
      {
        name: `${E.team || '👥'} Team Tools`,
        value: 'Quick list of team management commands.',
        inline: false
      }
    )
    .setColor(0x5865F2)
    .setFooter({ text: 'Admin Panel • Owner/Admin dashboard shortcuts' });
}

function buildPanelButtons() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('adminpanel_backupteams')
      .setLabel('💾 Backup Teams')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('adminpanel_backupfixtures')
      .setLabel('💾 Backup Fixtures')
      .setStyle(ButtonStyle.Primary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('adminpanel_refreshlive')
      .setLabel('🏆 Refresh Live')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('adminpanel_resethelp')
      .setLabel('♻️ Reset Help')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('adminpanel_teamtools')
      .setLabel('👥 Team Tools')
      .setStyle(ButtonStyle.Secondary)
  );

  return [row1, row2];
}

function makeBackupAttachment(type, range, rows) {
  const backup = {
    type,
    createdAt: new Date().toISOString(),
    range,
    rows
  };

  const filename = `${type.replace('_backup', '')}-backup-${Date.now()}.json`;
  const buffer = Buffer.from(JSON.stringify(backup, null, 2), 'utf8');
  return {
    filename,
    attachment: new AttachmentBuilder(buffer, { name: filename })
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('adminpanel')
    .setDescription('Open the owner admin dashboard'),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return { content: '🚫 Admin only command.', ephemeral: true };
    }

    return {
      embeds: [buildPanelEmbed()],
      components: buildPanelButtons()
    };
  },

  async buttonHandler(interaction, action) {
    if (!isAdmin(interaction)) {
      return { content: '🚫 Admin only command.', components: [] };
    }

    if (action === 'backupteams') {
      const rows = await getData('Teams!A:H');
      if (!Array.isArray(rows) || rows.length <= 1) {
        return { content: '❌ No Teams data found.', components: [] };
      }

      const { filename, attachment } = makeBackupAttachment('teams_backup', 'Teams!A:H', rows);

      sendAuditLog(interaction, {
        title: '💾 Teams Backup Created From Admin Panel',
        description: `Backup file created: **${filename}**`,
        color: 0x3498DB,
        fields: [
          { name: '📄 Rows', value: String(rows.length), inline: true }
        ]
      });

      return {
        embeds: [
          new EmbedBuilder()
            .setTitle('💾 Teams Backup Ready')
            .setDescription(buildBackupDescription('Teams', rows.length, filename))
            .addFields({ name: '📄 Rows', value: String(rows.length), inline: true })
            .setColor(0x3498DB)
            .setFooter({ text: 'Admin Panel • Teams backup created successfully' })
        ],
        files: [attachment],
        components: buildPanelButtons()
      };
    }

    if (action === 'backupfixtures') {
      const rows = await getData('Fixtures!A:I');
      if (!Array.isArray(rows) || rows.length <= 1) {
        return { content: '❌ No Fixtures data found.', components: [] };
      }

      const { filename, attachment } = makeBackupAttachment('fixtures_backup', 'Fixtures!A:I', rows);

      sendAuditLog(interaction, {
        title: '💾 Fixtures Backup Created From Admin Panel',
        description: `Backup file created: **${filename}**`,
        color: 0x3498DB,
        fields: [
          { name: '📄 Rows', value: String(rows.length), inline: true }
        ]
      });

      return {
        embeds: [
          new EmbedBuilder()
            .setTitle('💾 Fixtures Backup Ready')
            .setDescription(buildBackupDescription('Fixtures', rows.length, filename))
            .addFields({ name: '📄 Rows', value: String(rows.length), inline: true })
            .setColor(0x3498DB)
            .setFooter({ text: 'Admin Panel • Fixtures backup created successfully' })
        ],
        files: [attachment],
        components: buildPanelButtons()
      };
    }

    if (action === 'refreshlive') {
      const liveResult = await refreshLiveStandings(interaction.client, interaction.guild.id);
      const status = liveResult.ok ? '✅ Live standings refreshed.' : `⚠️ ${liveResult.reason}`;

      sendAuditLog(interaction, {
        title: '🏆 Live Standings Refreshed From Admin Panel',
        description: status,
        color: liveResult.ok ? 0x2ECC71 : 0xE67E22
      });

      return {
        embeds: [
          new EmbedBuilder()
            .setTitle('🏆 Live Standings Refresh')
            .setDescription(buildLiveRefreshDescription(status))
            .setColor(liveResult.ok ? 0x2ECC71 : 0xE67E22)
            .setFooter({ text: 'Admin Panel • Live standings refresh action' })
        ],
        components: buildPanelButtons()
      };
    }

    if (action === 'resethelp') {
      return {
        embeds: [
          new EmbedBuilder()
            .setTitle('♻️ Reset Tools')
            .setDescription('For safety, reset actions are not one-click buttons. Use these commands manually after archiving the season first.')
            .addFields(
              { name: '📦 Archive first', value: '`/endseason season:Season 1 type:coop confirm:true`', inline: false },
              { name: '♻️ Reset results only', value: '`/resetseason type:results confirm:CONFIRM`', inline: false },
              { name: '🚫 Reset discipline only', value: '`/resetseason type:discipline confirm:CONFIRM`', inline: false },
              { name: '⚠️ Reset all', value: '`/resetseason type:all confirm:CONFIRM`', inline: false }
            )
            .setColor(0xE67E22)
            .setFooter({ text: 'Admin Panel • Reset help only, no one-click reset buttons' })
        ],
        components: buildPanelButtons()
      };
    }

    if (action === 'teamtools') {
      return {
        embeds: [
          new EmbedBuilder()
            .setTitle('👥 Team Tools')
            .setDescription('Quick team-management command list for common admin actions and team lookups.')
            .addFields(
              { name: '➕ Add Team', value: '`/addteam`', inline: true },
              { name: '🔁 Replace Team', value: '`/replaceteam`', inline: true },
              { name: '🗑️ Remove Team', value: '`/removeteam`', inline: true },
              { name: '🖼️ Add Logo', value: '`/addteamlogo`', inline: true },
              { name: `${E.team || '🏟️'} My Team`, value: '`/myteam team:<team>`', inline: true },
              { name: '🙋 My Team', value: '`/myteam`', inline: true }
            )
            .setColor(0x5865F2)
            .setFooter({ text: 'Admin Panel • Team tools shortcut list' })
        ],
        components: buildPanelButtons()
      };
    }

    return {
      embeds: [buildPanelEmbed()],
      components: buildPanelButtons()
    };
  }
};