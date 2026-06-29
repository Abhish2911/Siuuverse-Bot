const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { getData } = require('../utils/sheets');
const emojis = require('../utils/emojis');

function buildEmbed({
  clubName,
  managerMention,
  managerName,
  clubPlayers,
  avgOVR,
  rosterPages,
  page,
  emojis
}) {
  return new EmbedBuilder()
    .setColor(0x00AE86)
    .setTitle(`${emojis.team} ${clubName}`)
    .setDescription([
      `${emojis.captain} **Manager:** ${managerMention}`,
      `${emojis.league} **Club:** ${clubName}`
    ].join('\n'))
    .addFields(
      {
        name: '📊 Club Stats',
        value: [
          `**Squad Size:** ${clubPlayers.length}`,
          `**Average OVR:** ${avgOVR}`
        ].join('\n'),
        inline: true
      },
      {
        name: `${emojis.captain} Manager Name`,
        value: `**${managerName}**`,
        inline: true
      },
      {
        name: `${emojis.profile} Squad Roster (Page ${page + 1}/${rosterPages.length})`,
        value: rosterPages[page] || 'No Players Found'
      }
    )
    .setFooter({
      text: `Roleplay Club Profile • ${clubPlayers.length} Players`
    })
    .setTimestamp();
}

function buildButtons(page, totalPages) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`myrpclub_prev_${page}`)
        .setLabel('◀ Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(`myrpclub_next_${page}`)
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1)
    )
  ];
}

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

    const rosterLines = clubPlayers
      .sort((a, b) => Number(b[2] || 0) - Number(a[2] || 0))
      .map(row => {
        const name = row[1] || 'Unknown';
        const ovr = row[2] || '0';
        const marketValue = row[3] || '0';
        const tp = row[16] || '0';

        return `• **${name}** (<@${row[0]}>)\n   OVR: **${ovr}** • MV: **${marketValue}** • TP: **${tp}**`;
      });

    const rosterPages = [];
    for (let i = 0; i < rosterLines.length; i += 15) {
      rosterPages.push(rosterLines.slice(i, i + 15).join('\n\n'));
    }

    const page = 0;

    const embed = buildEmbed({
      clubName,
      managerMention,
      managerName,
      clubPlayers,
      avgOVR,
      rosterPages,
      page,
      emojis
    });

    await interaction.editReply({
      embeds: [embed],
      components: buildButtons(page, rosterPages.length)
    });
  },

  async buttonHandler(interaction, action, value) {
    const data = interaction.message.embeds?.[0];
    if (!data) return;

    const title = data.title?.replace(`${emojis.team} `, '') || '';

    const rows = await getData(
      'Player_Data!A:Q',
      { spreadsheetId: process.env.RP_SHEET_ID }
    );

    const normalizeClubName = value => String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[._-]/g, '');

    const clubPlayers = rows.slice(1).filter(row => {
      const playerClub = normalizeClubName(row[5]);
      const targetClub = normalizeClubName(title);
      return playerClub === targetClub;
    });

    const totalOVR = clubPlayers.reduce((sum, row) => sum + Number(row[2] || 0), 0);
    const avgOVR = clubPlayers.length
      ? (totalOVR / clubPlayers.length).toFixed(1)
      : '0';

    const rosterLines = clubPlayers
      .sort((a, b) => Number(b[2] || 0) - Number(a[2] || 0))
      .map(row => `• **${row[1]}** (<@${row[0]}>)\n   OVR: **${row[2] || 0}** • MV: **${row[3] || 0}** • TP: **${row[16] || 0}**`);

    const rosterPages = [];
    for (let i = 0; i < rosterLines.length; i += 15) {
      rosterPages.push(rosterLines.slice(i, i + 15).join('\n\n'));
    }

    let page = Number(value || 0);
    if (action === 'next') page++;
    if (action === 'prev') page--;

    page = Math.max(0, Math.min(page, rosterPages.length - 1));

    const managerMention = data.description?.match(/<@(\d+)>/)?.[0] || 'Unknown';
    const managerName = data.fields?.[1]?.value?.replace(/\*/g, '') || 'Unknown';

    return {
      embeds: [buildEmbed({
        clubName: title,
        managerMention,
        managerName,
        clubPlayers,
        avgOVR,
        rosterPages,
        page,
        emojis
      })],
      components: buildButtons(page, rosterPages.length)
    };
  }
};
