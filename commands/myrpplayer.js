const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { getData } = require('../utils/sheets');
const emojis = require('../utils/emojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('myrpplayer')
    .setDescription('View an RP player profile')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('View another user\'s RP player profile')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('player')
        .setDescription('Search by RP player name')
        .setRequired(false)
    ),

  async execute(interaction) {
    // Load only the relevant sheets: Player_Data, Wages, Stats_Ranking, All_Time_Ranking
    const [
      rows,
      wagesRows,
      statsRows,
      allTimeRankingRows
    ] = await Promise.all([
      getData('Player_Data!A:Q', {
        spreadsheetId: process.env.RP_SHEET_ID
      }),
      getData('Wages!A:D', {
        spreadsheetId: process.env.RP_SHEET_ID
      }),
      getData('Stats_Ranking!A:BK', {
        spreadsheetId: process.env.RP_SHEET_ID
      }),
      getData('All_Time_Ranking!A:O', {
        spreadsheetId: process.env.RP_SHEET_ID
      })
    ]);

    const targetUser = interaction.options.getUser('user');
    const playerNameSearch = interaction.options.getString('player');

    let playerRow;

    if (playerNameSearch) {
      const search = playerNameSearch.trim().toLowerCase();

      playerRow = rows
        .slice(1)
        .find(row => {
          const playerName = String(row[1] || '').trim().toLowerCase();

          return (
            playerName === search ||
            playerName.includes(search) ||
            search.includes(playerName)
          );
        });
    } else {
      const lookupUser = targetUser || interaction.user;

      playerRow = rows
        .slice(1)
        .find(row => String(row[0] || '').trim() === lookupUser.id);
    }

    if (!playerRow) {
      return interaction.editReply({
        content: `❌ RP player not found.`
      });
    }

    const player = {
      discordId: playerRow[0] || 'N/A',
      playerName: playerRow[1] || 'N/A',
      ovr: playerRow[2] || '0',
      marketValue: playerRow[3] || '0',
      positions: playerRow[4] || 'N/A',
      club: playerRow[5] || 'Free Agent',
      shooting: Number(playerRow[6] || 0),
      passing: Number(playerRow[7] || 0),
      dribbling: Number(playerRow[8] || 0),
      dexterity: Number(playerRow[9] || 0),
      lowerBody: Number(playerRow[10] || 0),
      aerial: Number(playerRow[11] || 0),
      defending: Number(playerRow[12] || 0),
      gk1: Number(playerRow[13] || 0),
      gk2: Number(playerRow[14] || 0),
      gk3: Number(playerRow[15] || 0),
      tp: Number(playerRow[16] || 0)
    };

    const wageRow = wagesRows
      .slice(1)
      .find(row => String(row[1] || '').trim() === player.discordId);

    const wages = wageRow && String(wageRow[3] || '').trim() !== ''
      ? `$${Number(String(wageRow[3]).replace(/,/g, '')).toLocaleString()}`
      : 'Not Set';

    let discordUsername = 'Unknown User';
    let avatarURL = interaction.client.user.displayAvatarURL({
      extension: 'png',
      size: 512
    });

    try {
      const discordUser = await interaction.client.users.fetch(player.discordId);
      discordUsername = discordUser.username;
      avatarURL = discordUser.displayAvatarURL({
        extension: 'png',
        size: 512
      });
    } catch {
      discordUsername = 'Unknown User';
    }

    // --- Stats lookup logic ---
    // Helper for all-time ranking
    function getPlayerStats(rows, playerName) {
      const name = String(playerName).trim().toLowerCase();
      const stats = { goals: 0, assists: 0, saves: 0, cleanSheets: 0 };
      if (!Array.isArray(rows)) return stats;
      for (const row of rows.slice(1)) {
        if (row[1] && String(row[1]).trim().toLowerCase() === name) stats.goals = Number(row[2] || 0);
        if (row[5] && String(row[5]).trim().toLowerCase() === name) stats.assists = Number(row[6] || 0);
        if (row[9] && String(row[9]).trim().toLowerCase() === name) stats.saves = Number(row[10] || 0);
        if (row[13] && String(row[13]).trim().toLowerCase() === name) stats.cleanSheets = Number(row[14] || 0);
      }
      return stats;
    }
    // Helper for Stats_Ranking sheet
    function getCompetitionStats(rows, playerName, section) {
      const offsets = {
        league: 0,
        ucl: 16,
        fa: 32,
        shield: 48
      };
      const offset = offsets[section] || 0;
      const name = String(playerName).trim().toLowerCase();
      let stats = { goals: 0, assists: 0, saves: 0, cleanSheets: 0 };
      if (!Array.isArray(rows)) return stats;
      for (const row of rows.slice(1)) {
        // Player name always in col 1
        if (row[1] && String(row[1]).trim().toLowerCase() === name) {
          stats.goals = Number(row[offset + 1] || 0) + Number(row[offset + 2] || 0);
          stats.assists = Number(row[offset + 5] || 0) + Number(row[offset + 6] || 0);
          stats.saves = Number(row[offset + 9] || 0) + Number(row[offset + 10] || 0);
          stats.cleanSheets = Number(row[offset + 13] || 0) + Number(row[offset + 14] || 0);
          break;
        }
      }
      return stats;
    }
    // Default to league stats for the main profile page, using Stats_Ranking
    const playerStats = getCompetitionStats(statsRows, player.playerName, 'league');

    const profileButtonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`myrpprofile_${interaction.user.id}_${player.discordId}`)
        .setLabel('Profile')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`myrpstats_league_${interaction.user.id}_${player.discordId}`)
        .setLabel('Current League')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`myrpstats_ucl_${interaction.user.id}_${player.discordId}`)
        .setLabel('UCL')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`myrpstats_fa_${interaction.user.id}_${player.discordId}`)
        .setLabel('FA Cup')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`myrpstats_shield_${interaction.user.id}_${player.discordId}`)
        .setLabel('Community Shield')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`myrpstats_alltime_${interaction.user.id}_${player.discordId}`)
        .setLabel('All Time')
        .setStyle(ButtonStyle.Primary)
    );

    const embed = new EmbedBuilder()
      .setColor(0x00AE86)
      .setTitle(`⚽ ${player.playerName}`)
      .setThumbnail(avatarURL)
      .setDescription([
        `**OVR:** ${player.ovr} • **MV:** ${player.marketValue}`,
        `**Club:** ${player.club}`,
        `**Positions:** ${player.positions}`,
        `**Total TP:** ${player.tp}`,
        `**Weekly Wages:** ${wages}`
      ].join('\n'))
      .addFields(
        {
          name: `${emojis.profile} Player`,
          value: `**${player.playerName}**`,
          inline: true
        },
        {
          name: 'Discord Username',
          value: `**${discordUsername}**`,
          inline: true
        },
        {
          name: '‎',
          value: '‎',
          inline: true
        },
        {
          name: `${emojis.Stats} Training Points (1/2)`,
          value: [
            `**SHT:** ${player.shooting}`,
            `**PAS:** ${player.passing}`,
            `**DEX:** ${player.dexterity}`,
            `**DRI:** ${player.dribbling}`,
            `**LBS:** ${player.lowerBody}`
          ].join('\n'),
          inline: true
        },
        {
          name: `${emojis.Stats} Training Points (2/2)`,
          value: [
            `**AER:** ${player.aerial}`,
            `**DEF:** ${player.defending}`,
            `**GK1:** ${player.gk1}`,
            `**GK2:** ${player.gk2}`,
            `**GK3:** ${player.gk3}`
          ].join('\n'),
          inline: true
        }
      )
      .setFooter({ text: `Roleplay Player Profile • Requested by ${interaction.user.username}` })
      .setAuthor({
        name: `${player.playerName} Profile`
      })
      .setTimestamp();

    if (interaction.deferred || interaction.replied) {
      return interaction.editReply({ embeds: [embed], components: [profileButtonRow] });
    }

    return interaction.reply({ embeds: [embed], components: [profileButtonRow] });
  },
  /**
   * Handles button interaction for Stats.
   */
  async handleButton(interaction) {
    if (!interaction.isButton()) return;
    const customId = interaction.customId;
    let ownerId, discordId;
    // Helper for all-time ranking
    function getPlayerStats(rows, playerName) {
      const name = String(playerName).trim().toLowerCase();
      const stats = { goals: 0, assists: 0, saves: 0, cleanSheets: 0 };
      if (!Array.isArray(rows)) return stats;
      for (const row of rows.slice(1)) {
        if (row[1] && String(row[1]).trim().toLowerCase() === name) stats.goals = Number(row[2] || 0);
        if (row[5] && String(row[5]).trim().toLowerCase() === name) stats.assists = Number(row[6] || 0);
        if (row[9] && String(row[9]).trim().toLowerCase() === name) stats.saves = Number(row[10] || 0);
        if (row[13] && String(row[13]).trim().toLowerCase() === name) stats.cleanSheets = Number(row[14] || 0);
      }
      return stats;
    }
    // Helper for Stats_Ranking sheet
    function getCompetitionStats(rows, playerName, section) {
      const offsets = {
        league: 0,
        ucl: 16,
        fa: 32,
        shield: 48
      };
      const offset = offsets[section] || 0;
      const name = String(playerName).trim().toLowerCase();
      let stats = { goals: 0, assists: 0, saves: 0, cleanSheets: 0 };
      if (!Array.isArray(rows)) return stats;
      for (const row of rows.slice(1)) {
        // Player name always in col 1
        if (row[1] && String(row[1]).trim().toLowerCase() === name) {
          stats.goals = Number(row[offset + 1] || 0) + Number(row[offset + 2] || 0);
          stats.assists = Number(row[offset + 5] || 0) + Number(row[offset + 6] || 0);
          stats.saves = Number(row[offset + 9] || 0) + Number(row[offset + 10] || 0);
          stats.cleanSheets = Number(row[offset + 13] || 0) + Number(row[offset + 14] || 0);
          break;
        }
      }
      return stats;
    }
    if (customId.startsWith('myrpstats_')) {
      // Format: myrpstats_<type>_<ownerId>_<discordId>
      const split = customId.split('_');
      // [ 'myrpstats', <type>, <ownerId>, <discordId> ]
      const type = split[1];
      ownerId = split[2];
      discordId = split[3];
      if (ownerId && ownerId !== interaction.user.id) {
        return interaction.reply({
          content: '❌ Only the user who ran this command can use these buttons.',
          ephemeral: true
        });
      }
      // Fetch player data, Stats_Ranking, and All_Time_Ranking sheets
      const [
        rows,
        statsRows,
        allTimeRankingRows
      ] = await Promise.all([
        getData('Player_Data!A:Q', { spreadsheetId: process.env.RP_SHEET_ID }),
        getData('Stats_Ranking!A:BK', { spreadsheetId: process.env.RP_SHEET_ID }),
        getData('All_Time_Ranking!A:O', { spreadsheetId: process.env.RP_SHEET_ID })
      ]);
      // Find player row by Discord ID
      const playerRow = rows
        .slice(1)
        .find(row => String(row[0] || '').trim() === discordId);
      if (!playerRow) {
        return interaction.update({ content: '❌ Player not found.', embeds: [], components: [] });
      }
      const playerName = playerRow[1] || 'N/A';
      let stats, titleSuffix;
      if (type === 'alltime') {
        stats = getPlayerStats(allTimeRankingRows, playerName);
        titleSuffix = 'All Time Stats';
      } else {
        stats = getCompetitionStats(statsRows, playerName, type);
        switch (type) {
          case 'ucl':
            titleSuffix = 'UCL Stats';
            break;
          case 'fa':
            titleSuffix = 'FA Cup Stats';
            break;
          case 'shield':
            titleSuffix = 'Community Shield Stats';
            break;
          case 'league':
          default:
            titleSuffix = 'League Stats';
            break;
        }
      }
      const statsEmbed = new EmbedBuilder()
        .setColor(0x00AE86)
        .setTitle(`${playerName} RP ${titleSuffix}`)
        .addFields(
          { name: `${emojis.goal} Goals`, value: String(stats.goals), inline: true },
          { name: `${emojis.assist} Assists`, value: String(stats.assists), inline: true },
          { name: `${emojis.save} GK Saves`, value: String(stats.saves), inline: true },
          { name: `${emojis.cleanSheet || '🧤'} Clean Sheets`, value: String(stats.cleanSheets), inline: true }
        )
        .setTimestamp();
      // Buttons: Profile + all 5 stats buttons
      return interaction.update({
        embeds: [statsEmbed],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`myrpprofile_${ownerId}_${discordId}`)
              .setLabel('Profile')
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId(`myrpstats_league_${ownerId}_${discordId}`)
              .setLabel('Current League')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`myrpstats_ucl_${ownerId}_${discordId}`)
              .setLabel('UCL')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`myrpstats_fa_${ownerId}_${discordId}`)
              .setLabel('FA Cup')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`myrpstats_shield_${ownerId}_${discordId}`)
              .setLabel('Community Shield')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`myrpstats_alltime_${ownerId}_${discordId}`)
              .setLabel('All Time')
              .setStyle(ButtonStyle.Primary)
          )
        ]
      });
    } else if (customId.startsWith('myrpprofile_')) {
      // Parse ownerId and discordId from customId
      [ownerId, discordId] = customId.slice('myrpprofile_'.length).split('_');
      if (ownerId && ownerId !== interaction.user.id) {
        return interaction.reply({
          content: '❌ Only the user who ran this command can use these buttons.',
          ephemeral: true
        });
      }
      const [rows, wagesRows] = await Promise.all([
        getData('Player_Data!A:Q', { spreadsheetId: process.env.RP_SHEET_ID }),
        getData('Wages!A:D', { spreadsheetId: process.env.RP_SHEET_ID })
      ]);
      const playerRow = rows
        .slice(1)
        .find(row => String(row[0] || '').trim() === discordId);
      if (!playerRow) {
        return interaction.update({ content: '❌ Player not found.', embeds: [], components: [] });
      }
      const player = {
        discordId: playerRow[0] || 'N/A',
        playerName: playerRow[1] || 'N/A',
        ovr: playerRow[2] || '0',
        marketValue: playerRow[3] || '0',
        positions: playerRow[4] || 'N/A',
        club: playerRow[5] || 'Free Agent',
        shooting: Number(playerRow[6] || 0),
        passing: Number(playerRow[7] || 0),
        dribbling: Number(playerRow[8] || 0),
        dexterity: Number(playerRow[9] || 0),
        lowerBody: Number(playerRow[10] || 0),
        aerial: Number(playerRow[11] || 0),
        defending: Number(playerRow[12] || 0),
        gk1: Number(playerRow[13] || 0),
        gk2: Number(playerRow[14] || 0),
        gk3: Number(playerRow[15] || 0),
        tp: Number(playerRow[16] || 0)
      };
      const wageRow = wagesRows
        .slice(1)
        .find(row => String(row[1] || '').trim() === player.discordId);
      const wages = wageRow && String(wageRow[3] || '').trim() !== ''
        ? `$${Number(String(wageRow[3]).replace(/,/g, '')).toLocaleString()}`
        : 'Not Set';
      let discordUsername = 'Unknown User';
      let avatarURL = interaction.client.user.displayAvatarURL({
        extension: 'png',
        size: 512
      });
      try {
        const discordUser = await interaction.client.users.fetch(player.discordId);
        discordUsername = discordUser.username;
        avatarURL = discordUser.displayAvatarURL({
          extension: 'png',
          size: 512
        });
      } catch {
        discordUsername = 'Unknown User';
      }
      const profileButtonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`myrpprofile_${ownerId}_${player.discordId}`)
          .setLabel('Profile')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`myrpstats_${ownerId}_${player.discordId}`)
          .setLabel('Stats')
          .setStyle(ButtonStyle.Primary)
      );
      const embed = new EmbedBuilder()
        .setColor(0x00AE86)
        .setTitle(`⚽ ${player.playerName}`)
        .setThumbnail(avatarURL)
        .setDescription([
          `**OVR:** ${player.ovr} • **MV:** ${player.marketValue}`,
          `**Club:** ${player.club}`,
          `**Positions:** ${player.positions}`,
          `**Total TP:** ${player.tp}`,
          `**Weekly Wages:** ${wages}`
        ].join('\n'))
        .addFields(
          {
            name: `${emojis.profile} Player`,
            value: `**${player.playerName}**`,
            inline: true
          },
          {
            name: 'Discord Username',
            value: `**${discordUsername}**`,
            inline: true
          },
          {
            name: '‎',
            value: '‎',
            inline: true
          },
          {
            name: `${emojis.Stats} Training Points (1/2)`,
            value: [
              `**SHT:** ${player.shooting}`,
              `**PAS:** ${player.passing}`,
              `**DEX:** ${player.dexterity}`,
              `**DRI:** ${player.dribbling}`,
              `**LBS:** ${player.lowerBody}`
            ].join('\n'),
            inline: true
          },
          {
            name: `${emojis.Stats} Training Points (2/2)`,
            value: [
              `**AER:** ${player.aerial}`,
              `**DEF:** ${player.defending}`,
              `**GK1:** ${player.gk1}`,
              `**GK2:** ${player.gk2}`,
              `**GK3:** ${player.gk3}`
            ].join('\n'),
            inline: true
          }
        )
        .setFooter({ text: `Roleplay Player Profile • Requested by ${interaction.user.username}` })
        .setAuthor({
          name: `${player.playerName} Profile`
        })
        .setTimestamp();
      return interaction.update({ embeds: [embed], components: [profileButtonRow] });
    }
  }
};
