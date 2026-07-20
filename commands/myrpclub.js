const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getData } = require('../utils/sheets');
const emojis = require('../utils/emojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('myrpclub')
    .setDescription('Shows an RP club profile and roster.')
    .addStringOption(option =>
      option
        .setName('club')
        .setDescription('Search for a club by name')
        .setRequired(false)
    ),
  async execute(interaction) {
    const userId = interaction.user.id;
    const clubSearch = interaction.options.getString('club');
    let managerRows;
    let rows;
    let statsRows;
    try {
      rows = await getData(
        'Player_Data!A:Q',
        { spreadsheetId: process.env.RP_SHEET_ID }
      );
      managerRows = await getData(
        'Managers!A:C',
        { spreadsheetId: process.env.RP_SHEET_ID }
      );
      statsRows = await getData(
        'Stats_Ranking!A:K',
        { spreadsheetId: process.env.RP_SHEET_ID }
      );
    } catch (err) {
      return interaction.editReply('❌ Failed to fetch RP data.');
    }
    // Find player row first, then manager row as fallback
    const playerRow = rows.slice(1).find(
      row => String(row[0] || '').trim() === userId
    );

    const managerAccessRow = managerRows
      .slice(1)
      .find(row => String(row[0] || '').trim() === userId);

    let clubName;

    if (clubSearch) {
      const search = clubSearch.trim().toLowerCase();

      const matchedPlayer = rows.slice(1).find(row => {
        const club = String(row[5] || '').trim().toLowerCase();

        return (
          club === search ||
          club.includes(search) ||
          search.includes(club)
        );
      });

      const matchedManager = managerRows.slice(1).find(row => {
        const club = String(row[2] || '').trim().toLowerCase();

        return (
          club === search ||
          club.includes(search) ||
          search.includes(club)
        );
      });

      clubName = matchedPlayer?.[5] || matchedManager?.[2];

      if (!clubName) {
        return interaction.editReply('❌ Club not found.');
      }
    } else if (playerRow) {
      clubName = playerRow[5];
    } else if (managerAccessRow) {
      clubName = managerAccessRow[2];
    } else {
      return interaction.editReply('❌ You are not registered as an RP player or manager.');
    }

    if (!clubName) {
      return interaction.editReply('❌ Club roster not found.');
    }

    const normalizeClubName = value => String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[._-]/g, '');

    const clubPlayers = rows.slice(1).filter(row => {
      const playerClub = normalizeClubName(row[5]);
      const targetClub = normalizeClubName(clubName);

      return (
        playerClub === targetClub ||
        playerClub.includes(targetClub) ||
        targetClub.includes(playerClub)
      );
    });

    if (!clubPlayers || clubPlayers.length === 0) {
      return interaction.editReply('❌ Club roster not found.');
    }

    const normalizedClub = normalizeClubName(clubName);

    const managerRow = managerRows
      .slice(1)
      .find(row => {
        const managerClub = normalizeClubName(row[2]);

        return (
          managerClub === normalizedClub ||
          managerClub.includes(normalizedClub) ||
          normalizedClub.includes(managerClub)
        );
      });

    if (!managerRow) {
      console.log(`[MYRPCLUB] Manager not found for club: ${clubName}`);
    }

    const managerMention = managerRow
      ? `<@${managerRow[0]}>`
      : 'Unknown';

    const managerName = managerRow?.[1] || 'Unknown';

    const totalOVR = clubPlayers.reduce((sum, row) => sum + Number(row[2] || 0), 0);
    const avgOVR = clubPlayers.length
      ? (totalOVR / clubPlayers.length).toFixed(1)
      : '0';

    const sortedPlayers = clubPlayers
      .sort((a, b) => Number(b[2] || 0) - Number(a[2] || 0));

    const midpoint = Math.ceil(sortedPlayers.length / 2);

    const formatColumn = (players, startIndex) => players
      .map((row, index) => {
        const name = row[1] || 'Unknown';
        const ovr = row[2] || '0';
        const mv = row[3] || '0';
        const tp = row[16] || '0';

        return `\`${startIndex + index}.\` **${name}**\n> ${emojis.rank} ${ovr} ⚽︎ 💸 ${mv} ⚽︎ ${emojis.Stats} ${tp}`;
      })
      .join('\n');

    const leftColumn = formatColumn(sortedPlayers.slice(0, midpoint), 1);
    const rightColumn = formatColumn(sortedPlayers.slice(midpoint), midpoint + 1);

    const embed = new EmbedBuilder()
      .setColor(0x00AE86)
      .setTitle(`${emojis.team} ${clubName}`)
      .setDescription([
        `${emojis.captain} **Manager:** ${managerMention}`,
        `${emojis.league} **Club:** **${clubName}**`,
        '',
        `### ${emojis.profile} Squad Roster`
      ].join('\n'))
      .addFields(
        {
          name: 'Players (1/2)',
          value: leftColumn || '—',
          inline: true
        },
        {
          name: 'Players (2/2)',
          value: rightColumn || '—',
          inline: true
        },
        {
          name: '\u200B',
          value: '\u200B',
          inline: false
        },
        {
          name: '📊 Club Stats',
          value: [
            `👥 **Squad Size:** ${clubPlayers.length}`,
            `⭐ **Average OVR:** ${avgOVR}`
          ].join('\n'),
          inline: false
        },
        {
          name: `${emojis.captain} Manager Name`,
          value: `**${managerName}**`,
          inline: false
        }
      )
      .setFooter({
        text: `Roleplay Club Profile • ${clubPlayers.length} Players`
      })
      .setTimestamp();
    // Add Club Stats button
    const statsButtonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`myrpclubstats_${interaction.user.id}_${clubName}`)
        .setLabel('Club Stats')
        .setStyle(ButtonStyle.Primary)
    );
    await interaction.editReply({ embeds: [embed], components: [statsButtonRow] });
  },
  // Button handler for club stats
  async handleButton(interaction) {
    if (!interaction.customId) return;

    let ownerId, clubName;

    if (interaction.customId.startsWith('myrpclubdetails_')) {
      const parts = interaction.customId.substring('myrpclubdetails_'.length).split('_');
      ownerId = parts.shift();
      clubName = parts.join('_');

      if (ownerId !== interaction.user.id) {
        return interaction.reply({
          content: '❌ Only the user who ran this command can use these buttons.',
          ephemeral: true
        });
      }

      let managerRows;
      let rows;
      try {
        rows = await getData(
          'Player_Data!A:Q',
          { spreadsheetId: process.env.RP_SHEET_ID }
        );
        managerRows = await getData(
          'Managers!A:C',
          { spreadsheetId: process.env.RP_SHEET_ID }
        );
      } catch (err) {
        return interaction.update({ content: '❌ Failed to fetch RP data.', embeds: [], components: [] });
      }

      if (!clubName) {
        return interaction.update({ content: '❌ Club roster not found.', embeds: [], components: [] });
      }

      const normalizeClubName = value => String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[._-]/g, '');

      const clubPlayers = rows.slice(1).filter(row => {
        const playerClub = normalizeClubName(row[5]);
        const targetClub = normalizeClubName(clubName);

        return (
          playerClub === targetClub ||
          playerClub.includes(targetClub) ||
          targetClub.includes(playerClub)
        );
      });

      if (!clubPlayers || clubPlayers.length === 0) {
        return interaction.update({ content: '❌ Club roster not found.', embeds: [], components: [] });
      }

      const normalizedClub = normalizeClubName(clubName);

      const managerRow = managerRows
        .slice(1)
        .find(row => {
          const managerClub = normalizeClubName(row[2]);

          return (
            managerClub === normalizedClub ||
            managerClub.includes(normalizedClub) ||
            normalizedClub.includes(managerClub)
          );
        });

      if (!managerRow) {
        console.log(`[MYRPCLUB] Manager not found for club: ${clubName}`);
      }

      const managerMention = managerRow
        ? `<@${managerRow[0]}>`
        : 'Unknown';

      const managerName = managerRow?.[1] || 'Unknown';

      const totalOVR = clubPlayers.reduce((sum, row) => sum + Number(row[2] || 0), 0);
      const avgOVR = clubPlayers.length
        ? (totalOVR / clubPlayers.length).toFixed(1)
        : '0';

      const sortedPlayers = clubPlayers
        .sort((a, b) => Number(b[2] || 0) - Number(a[2] || 0));

      const midpoint = Math.ceil(sortedPlayers.length / 2);

      const formatColumn = (players, startIndex) => players
        .map((row, index) => {
          const name = row[1] || 'Unknown';
          const ovr = row[2] || '0';
          const mv = row[3] || '0';
          const tp = row[16] || '0';

          return `\`${startIndex + index}.\` **${name}**\n> ${emojis.rank} ${ovr} ⚽︎ 💸 ${mv} ⚽︎ ${emojis.Stats} ${tp}`;
        })
        .join('\n');

      const leftColumn = formatColumn(sortedPlayers.slice(0, midpoint), 1);
      const rightColumn = formatColumn(sortedPlayers.slice(midpoint), midpoint + 1);

      const embed = new EmbedBuilder()
        .setColor(0x00AE86)
        .setTitle(`${emojis.team} ${clubName}`)
        .setDescription([
          `${emojis.captain} **Manager:** ${managerMention}`,
          `${emojis.league} **Club:** **${clubName}**`,
          '',
          `### ${emojis.profile} Squad Roster`
        ].join('\n'))
        .addFields(
          {
            name: 'Players (1/2)',
            value: leftColumn || '—',
            inline: true
          },
          {
            name: 'Players (2/2)',
            value: rightColumn || '—',
            inline: true
          },
          {
            name: '\u200B',
            value: '\u200B',
            inline: false
          },
          {
            name: '📊 Club Stats',
            value: [
              `👥 **Squad Size:** ${clubPlayers.length}`,
              `⭐ **Average OVR:** ${avgOVR}`
            ].join('\n'),
            inline: false
          },
          {
            name: `${emojis.captain} Manager Name`,
            value: `**${managerName}**`,
            inline: false
          }
        )
        .setFooter({
          text: `Roleplay Club Profile • ${clubPlayers.length} Players`
        })
        .setTimestamp();

      const statsButtonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`myrpclubstats_${ownerId}_${clubName}`)
          .setLabel('Club Stats')
          .setStyle(ButtonStyle.Primary)
      );

      return interaction.update({ embeds: [embed], components: [statsButtonRow] });
    }

    if (!interaction.customId.startsWith('myrpclubstats_')) return;
    // Fetch latest data
    let rows, statsRows;
    try {
      rows = await getData(
        'Player_Data!A:Q',
        { spreadsheetId: process.env.RP_SHEET_ID }
      );
      // Use full stats range for all competitions
      statsRows = await getData(
        'Stats_Ranking!A:BK',
        { spreadsheetId: process.env.RP_SHEET_ID }
      );
    } catch (err) {
      return interaction.update({ content: '❌ Failed to fetch RP data.', embeds: [], components: [] });
    }
    const parts = interaction.customId.substring('myrpclubstats_'.length).split('_');
    ownerId = parts.shift();
    clubName = parts.join('_');

    if (ownerId !== interaction.user.id) {
      return interaction.reply({
        content: '❌ Only the user who ran this command can use these buttons.',
        ephemeral: true
      });
    }
    // Build set of club players (case-insensitive)
    const normalizeClubName = value => String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[._-]/g, '');
    const targetClub = normalizeClubName(clubName);
    const clubPlayers = rows.slice(1).filter(row => {
      const playerClub = normalizeClubName(row[5]);
      return (
        playerClub === targetClub ||
        playerClub.includes(targetClub) ||
        targetClub.includes(playerClub)
      );
    });
    // Set of player names (case-insensitive)
    const clubPlayerSet = new Set(
      clubPlayers.map(row => String(row[1] || '').trim().toLowerCase())
    );
    // Helper to format top list
    const formatTop = list => list.length
      ? list.map((p, i) => `\`${i + 1}.\` **${p.player}** — ${p.value}`).join('\n')
      : 'None';

    // Competition definitions and stat offsets
    const competitions = [
      { name: 'League', offset: 0 },
      { name: 'UCL', offset: 16 },
      { name: 'FA Cup', offset: 32 },
      { name: 'Community Shield', offset: 48 }
    ];

    // Helper to collect leaders for a competition offset
    function collectLeaders(offset) {
      const goals = [], assists = [], saves = [], cleanSheets = [];
      for (const row of statsRows.slice(1)) {
        const add = (nameCol, valCol, list) => {
          const player = String(row[nameCol] || '').trim();
          const value = Number(row[valCol] || 0);
          if (player && clubPlayerSet.has(player.toLowerCase()) && value > 0) list.push({ player, value });
        };
        add(offset + 1, offset + 2, goals);
        add(offset + 5, offset + 6, assists);
        add(offset + 9, offset + 10, saves);
        add(offset + 13, offset + 14, cleanSheets);
      }
      for (const arr of [goals, assists, saves, cleanSheets]) arr.sort((a, b) => b.value - a.value);
      return {
        goals: goals.slice(0, 5),
        assists: assists.slice(0, 5),
        saves: saves.slice(0, 5),
        cleanSheets: cleanSheets.slice(0, 5)
      };
    }

    // Build description for all competitions
    let description = '';
    for (const comp of competitions) {
      const leaders = collectLeaders(comp.offset);
      description += `__**${comp.name}**__\n`;
      description += `⚽ **Goals**\n${formatTop(leaders.goals)}\n`;
      description += `🎯 **Assists**\n${formatTop(leaders.assists)}\n`;
      description += `🧤 **Saves**\n${formatTop(leaders.saves)}\n`;
      description += `🛡️ **Clean Sheets**\n${formatTop(leaders.cleanSheets)}\n\n`;
    }

    const embed = new EmbedBuilder()
      .setColor(0x2196f3)
      .setTitle(`${clubName} Club Leaders`)
      .setDescription(description.trim())
      .setFooter({ text: 'Club Stat Leaders' })
      .setTimestamp();
    await interaction.update({
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`myrpclubdetails_${ownerId}_${clubName}`)
            .setLabel('Team Details')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`myrpclubstats_${ownerId}_${clubName}`)
            .setLabel('Club Stats')
            .setStyle(ButtonStyle.Primary)
        )
      ]
    });
  }
};
