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
        'Stats_Ranking!A:I',
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
        .setCustomId(`myrpclubstats_${clubName}`)
        .setLabel('Club Stats')
        .setStyle(ButtonStyle.Primary)
    );
    await interaction.editReply({ embeds: [embed], components: [statsButtonRow] });
  },
  // Button handler for club stats
  async handleButton(interaction) {
    if (!interaction.customId || !interaction.customId.startsWith('myrpclubstats_')) return;
    // Fetch latest data
    let rows, statsRows;
    try {
      rows = await getData(
        'Player_Data!A:Q',
        { spreadsheetId: process.env.RP_SHEET_ID }
      );
      statsRows = await getData(
        'Stats_Ranking!A:I',
        { spreadsheetId: process.env.RP_SHEET_ID }
      );
    } catch (err) {
      return interaction.reply({ content: '❌ Failed to fetch RP data.', ephemeral: true });
    }
    const clubName = interaction.customId.substring('myrpclubstats_'.length);
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
    // Prepare leaders
    let topScorer = { player: null, value: null };
    let topAssist = { player: null, value: null };
    let topClean = { player: null, value: null };
    for (let i = 1; i < statsRows.length; ++i) {
      const row = statsRows[i];
      // Goals: B(1), value C(2)
      const goalPlayer = String(row[1] || '').trim();
      const goalVal = Number(row[2] || 0);
      if (clubPlayerSet.has(goalPlayer.trim().toLowerCase())) {
        if (topScorer.value == null || goalVal > topScorer.value) {
          topScorer = { player: goalPlayer, value: goalVal };
        }
      }
      // Assists: E(4), value F(5)
      const assistPlayer = String(row[4] || '').trim();
      const assistVal = Number(row[5] || 0);
      if (clubPlayerSet.has(assistPlayer.trim().toLowerCase())) {
        if (topAssist.value == null || assistVal > topAssist.value) {
          topAssist = { player: assistPlayer, value: assistVal };
        }
      }
      // Clean Sheets: H(7), value I(8)
      const cleanPlayer = String(row[7] || '').trim();
      const cleanVal = Number(row[8] || 0);
      if (clubPlayerSet.has(cleanPlayer.trim().toLowerCase())) {
        if (topClean.value == null || cleanVal > topClean.value) {
          topClean = { player: cleanPlayer, value: cleanVal };
        }
      }
    }
    const embed = new EmbedBuilder()
      .setColor(0x2196f3)
      .setTitle(`${clubName} Club Leaders`)
      .addFields(
        {
          name: '⚽ Top Scorer',
          value:
            topScorer.player
              ? `${topScorer.player} — ${topScorer.value}`
              : 'None',
          inline: false
        },
        {
          name: '🎯 Top Assist',
          value:
            topAssist.player
              ? `${topAssist.player} — ${topAssist.value}`
              : 'None',
          inline: false
        },
        {
          name: '🧤 Most Clean Sheets',
          value:
            topClean.player
              ? `${topClean.player} — ${topClean.value}`
              : 'None',
          inline: false
        }
      )
      .setFooter({ text: 'Club Stat Leaders' })
      .setTimestamp();
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};