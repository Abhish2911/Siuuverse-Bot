const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const {
  appendData,
  updateData,
  getData
} = require('../utils/sheets');
const { cachedGetData, invalidateSheetCache } = require('../utils/helpers');
const E = require('../utils/emojis');

const pendingReserves = new Map();
const RESERVE_SHEET_RANGE = 'Reserve!A:F';
const TEAMS_SHEET_RANGE = 'Teams!A:Z';
const FIXTURES_SHEET_RANGE = 'Fixtures!A:J';
const MAX_ACTIVE_RESERVES_PER_CAPTAIN = 4;
const RESERVES_PER_PAGE = 4;

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function clean(value) {
  return String(value || '').trim();
}

function normalize(value) {
  return clean(value).toLowerCase();
}

function normalizeMatchNo(value) {
  return clean(value).toUpperCase();
}

function getCompetitionConfig(matchNo) {
  const code = normalizeMatchNo(matchNo);

  if (code.startsWith('FA ') || code.startsWith('FA-')) {
    return {
      key: 'fa',
      label: 'FA Cup',
      reserveLabel: 'FA Cup',
      fixturesRange: 'FA_Cup_Coop_Fixtures!A:K',
      matchNoIndex: 1,
      homeIndex: 3,
      awayIndex: 4
    };
  }

  if (code.startsWith('CB ') || code.startsWith('CB-') || code.startsWith('CAR-')) {
    return {
      key: 'carabao',
      label: 'Carabao Cup',
      reserveLabel: 'Carabao Cup',
      fixturesRange: 'Carabao_Coop_Fixtures!A:K',
      matchNoIndex: 1,
      homeIndex: 3,
      awayIndex: 4
    };
  }

  if (code.startsWith('UCL ') || code.startsWith('UCL-')) {
    const isGroupStage = code.includes('-GS-') || code.includes('GS-');
    return {
      key: 'ucl',
      label: 'UCL',
      reserveLabel: 'UCL',
      fixturesRange: isGroupStage ? 'UCL_Coop_Group_Fixtures!A:J' : 'UCL_Coop_Knockout_Fixtures!A:K',
      matchNoIndex: isGroupStage ? 0 : 1,
      homeIndex: isGroupStage ? 2 : 3,
      awayIndex: isGroupStage ? 3 : 4
    };
  }

  return {
    key: 'league',
    label: 'League',
    reserveLabel: 'League',
    fixturesRange: FIXTURES_SHEET_RANGE,
    matchNoIndex: 0,
    homeIndex: 2,
    awayIndex: 3
  };
}

function cleanRows(rows) {
  return Array.isArray(rows)
    ? rows.slice(1).filter(row => row.some(cell => clean(cell)))
    : [];
}

function compactList(value) {
  const text = clean(value);
  return text || 'N/A';
}

function getUserId(interaction) {
  return interaction.user?.id || interaction.member?.user?.id || '';
}

function extractDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function isOwner(interaction) {
  const ownerIds = String(process.env.OWNER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  return (
    ownerIds.includes(interaction.user.id) ||
    interaction.guild?.ownerId === interaction.user.id
  );
}

async function getTeamRows() {
  const data = await getData(TEAMS_SHEET_RANGE, { cache: false }).catch(() => []);
  return cleanRows(data);
}

async function getFixtureRows(range) {
  const data = await getData(range, { cache: false }).catch(() => []);
  return cleanRows(data);
}

function isCaptainOfEitherTeam(teamRows, userId, homeTeam, awayTeam) {
  const userDigits = extractDigits(userId);
  if (!userDigits) return false;

  return teamRows.some(row => {
    const teamName = clean(row[0]);
    const shortName = clean(row[2]);
    const captainId = extractDigits(row[4]);

    const matchesTeam =
      normalize(teamName) === normalize(homeTeam) ||
      normalize(shortName) === normalize(homeTeam) ||
      normalize(teamName) === normalize(awayTeam) ||
      normalize(shortName) === normalize(awayTeam);

    return matchesTeam && captainId === userDigits;
  });
}

function countActiveReservesByUser(rows, userId) {
  const targetId = clean(userId);
  return rows.filter(row => clean(row[4]) === targetId).length;
}

function buildReserveSummary(rows) {
  const latest = rows[0];
  const second = rows[1];
  const third = rows[2];

  const formatEntry = row => {
    if (!row) return 'N/A';
    return `\`${clean(row[1]) || 'N/A'}\` • ${clean(row[0]) || 'N/A'}`;
  };

  return {
    total: rows.length,
    latest: formatEntry(latest),
    second: formatEntry(second),
    third: formatEntry(third)
  };
}

function buildReserveListDescription(summary) {
  return (
    `${safeEmoji(E.calendar, '📅')} **Reserved Match Overview**\n` +
    `Current saved reserves across league and cup competitions.\n\n` +
    `${safeEmoji(E.played, '🎮')} **Total Reserves:** ${summary.total}\n` +
    `${safeEmoji(E.fire, '🔥')} **Latest:** ${summary.latest}\n` +
    `${safeEmoji(E.runnerUp || E.medal, '🥈')} **2nd:** ${summary.second}\n` +
    `${safeEmoji(E.medal, '🥉')} **3rd:** ${summary.third}`
  );
}

function buildReservePreviewDescription(matchNo, competition, activeCount) {
  return (
    `${safeEmoji(E.calendar, '📅')} **Reserve Preview**\n` +
    `Review the reserve details before saving. Teams are auto-detected from the selected match number and competition.\n\n` +
    `${safeEmoji(E.info || E.Badge, '📌')} **Competition:** ${competition.label}\n` +
    `${safeEmoji(E.doubleArrow || E.calendar, '➡️')} **Match:** ${matchNo}\n` +
    `${safeEmoji(E.lock, '🔒')} **Active Reserves:** ${activeCount}/${MAX_ACTIVE_RESERVES_PER_CAPTAIN}\n` +
    `${safeEmoji(E.profile, '👤')} **Rule:** Only captains can reserve unless an owner/admin uses the **by** option.`
  );
}

function buildReserveSuccessDescription(pending) {
  return (
    `**${pending.matchNo}** • **${pending.competition.label}**\n` +
    `${safeEmoji(E.home || E.team, '🏠')} ${compactList(pending.homeTeam)}\n` +
    `${safeEmoji(E.away || E.team, '🚩')} ${compactList(pending.awayTeam)}\n` +
    `${safeEmoji(E.profile, '👤')} <@${compactList(pending.reservedBy)}>${pending.playerName ? ` • **Player:** ${pending.playerName}` : ''}\n` +
    `${safeEmoji(E.lock, '🔒')} Limit: one captain can keep up to **${MAX_ACTIVE_RESERVES_PER_CAPTAIN}** active reserves.`
  );
}

function buildButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('reserve_confirm')
      .setLabel('Confirm')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('reserve_cancel')
      .setLabel('Cancel')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
  );
}

async function getReserveRows() {
  const data = await cachedGetData(RESERVE_SHEET_RANGE);
  return cleanRows(data);
}

async function buildReserveListEmbed(page = 0) {
  const rows = await getReserveRows();
  const totalPages = Math.max(1, Math.ceil(rows.length / RESERVES_PER_PAGE));
  page = Math.max(0, Math.min(page, totalPages - 1));
  const pageRows = rows.slice(
    page * RESERVES_PER_PAGE,
    page * RESERVES_PER_PAGE + RESERVES_PER_PAGE
  );
  const summary = buildReserveSummary(rows);

  const embed = new EmbedBuilder()
    .setTitle(`${safeEmoji(E.calendar, '📅')} Match Reserves`)
    .setDescription(buildReserveListDescription(summary))
    .addFields(
      {
        name: `${safeEmoji(E.stats || E.rank, '📊')} Reserve Feed`,
        value: (() => {
          if (!pageRows.length) return 'No reserved matches yet.';

          let output = '';

          for (const [index, row] of pageRows.entries()) {
            const entry =
              `**${page * RESERVES_PER_PAGE + index + 1}. ${clean(row[1]) || 'N/A'}** • ${clean(row[0]) || 'N/A'}\n` +
              `${safeEmoji(E.home || E.team, '🏠')} **Home:** ${clean(row[2]) || 'N/A'}\n` +
              `${safeEmoji(E.away || E.team, '🚩')} **Away:** ${clean(row[3]) || 'N/A'}\n` +
              `${safeEmoji(E.profile, '👤')} **By:** ${clean(row[4]) ? `<@${clean(row[4])}>` : 'N/A'}${clean(row[5]) ? ` • **Player:** ${clean(row[5])}` : ''}\n\n`;

            if ((output + entry).length > 1000) {
              output += `...and ${pageRows.length - index} more reserve(s).`;
              break;
            }

            output += entry;
          }

          return output.trim();
        })(),
        inline: false
      },
      {
        name: `${safeEmoji(E.played, '🎮')} Total Reserved`,
        value: String(rows.length),
        inline: true
      }
    )
    .setColor(0x3498DB)
    .setFooter({
      text: `Page ${page + 1}/${totalPages} • Total Reserved: ${rows.length}`
    })
    .setTimestamp();

  return embed;
}
function buildReservePageButtons(page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`reserve_page_${page - 1}`)
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`reserve_page_${page + 1}`)
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1)
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reserve')
    .setDescription('Reserve a match or view reserved matches')
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Reserve a match')
        .addStringOption(option =>
          option
            .setName('matchno')
            .setDescription('Match number')
            .setRequired(true)
        )
        .addUserOption(option =>
          option
            .setName('by')
            .setDescription('Optional: reserve on behalf of a specific user (owner/admin only)')
            .setRequired(false)
        )
        .addStringOption(option =>
          option
            .setName('playername')
            .setDescription('Optional: show a custom player name in reserve preview/list')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Admin only: remove a reserved match by match number')
        .addStringOption(option =>
          option
            .setName('matchno')
            .setDescription('Match number to remove')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('Show reserved matches')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('Show reserves for a specific user')
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'list') {
      const targetUser = interaction.options.getUser('user');

      if (!targetUser) {
        const rows = await getReserveRows();
        const totalPages = Math.max(1, Math.ceil(rows.length / RESERVES_PER_PAGE));

        return {
          embeds: [await buildReserveListEmbed(0)],
          components: [buildReservePageButtons(0, totalPages)]
        };
      }

      const rows = await getReserveRows();
      const teamRows = await getTeamRows();

      const userDigits = extractDigits(targetUser.id);
      const userTeams = teamRows
        .filter(row => extractDigits(row[4]) === userDigits)
        .flatMap(row => [clean(row[0]), clean(row[2])])
        .filter(Boolean)
        .map(normalize);

      const userRows = rows.filter(row => {
        const homeTeam = normalize(row[2]);
        const awayTeam = normalize(row[3]);

        return userTeams.includes(homeTeam) || userTeams.includes(awayTeam);
      });

      const embed = new EmbedBuilder()
        .setTitle(`${safeEmoji(E.calendar, '📅')} Reserve List`)
        .setDescription(`Reserved matches involving ${targetUser}'s team`)
        .setColor(0x3498DB)
        .setTimestamp();

      if (!userRows.length) {
        embed.addFields({
          name: 'No Reserves',
          value: 'No active reserves found for this user\'s team.'
        });
      } else {
        embed.addFields({
          name: `Active Reserves (${userRows.length})`,
          value: userRows.map(row =>
            `• **${clean(row[1])}** (${clean(row[0])})\n🏠 ${clean(row[2])} vs ${clean(row[3])}`
          ).join('\n\n').slice(0, 1024)
        });
      }

      return {
        embeds: [embed]
      };
    }

    if (subcommand === 'remove') {
      if (!interaction.memberPermissions?.has('Administrator') && !isOwner(interaction)) {
        return `${safeEmoji(E.wrong || E.error, '❌')} Only admins or owners can use **/reserve remove**.`;
      }

      const matchNo = normalizeMatchNo(interaction.options.getString('matchno'));
      const allData = await cachedGetData(RESERVE_SHEET_RANGE);
      const rows = cleanRows(allData);
      const targetIndex = rows.findIndex(row => normalizeMatchNo(row[1]) === normalizeMatchNo(matchNo));

      if (targetIndex === -1) {
        return `${safeEmoji(E.wrong || E.error, '❌')} No reserved match found for **${matchNo}**.`;
      }

      rows.splice(targetIndex, 1);

      try {
        const competition = getCompetitionConfig(matchNo);
        const fixtureData = await getData(
          competition.fixturesRange,
          { cache: false }
        ).catch(() => []);

        if (Array.isArray(fixtureData) && fixtureData.length > 1) {
          const fixtureRows = fixtureData.slice(1);
          const fixtureIndex = fixtureRows.findIndex(
            row =>
              normalizeMatchNo(
                row[competition.matchNoIndex]
              ) === normalizeMatchNo(matchNo)
          );

          if (fixtureIndex !== -1) {
            const statusIndex =
              competition.key === 'league' || competition.fixturesRange.includes('A:J')
                ? 9
                : 10;

            fixtureRows[fixtureIndex][statusIndex] = '';

            await updateData(
              `${competition.fixturesRange.split('!')[0]}!A2:${competition.fixturesRange.split(':')[1]}`,
              fixtureRows
            );
          }
        }
      } catch (err) {
        console.error('Reserve status reset failed:', err);
      }

      // Rewrite the entire reserve data range so removed rows do not leave
      // stale data behind (which causes the previous last row to appear duplicated).
      const blankRows = Array.from({ length: Math.max(1, rows.length + 10) }, () => ['', '', '', '', '', '']);

      await updateData('Reserve!A2:F', blankRows);

      if (rows.length) {
        await updateData('Reserve!A2:F', rows);
      }

      invalidateSheetCache(['Reserve!']);

      return {
        embeds: [
          new EmbedBuilder()
            .setTitle(`${safeEmoji(E.confirm, '✅')} Reserve Removed`)
            .setDescription(`Removed reserved match **${matchNo}**.`)
            .setColor(0xE74C3C)
            .setTimestamp()
        ]
      };
    }

    const matchNo = normalizeMatchNo(interaction.options.getString('matchno'));
    const competition = getCompetitionConfig(matchNo);
    const byUser = interaction.options.getUser('by');
    const playerName = clean(interaction.options.getString('playername'));
    if (byUser && !interaction.memberPermissions?.has('Administrator') && !isOwner(interaction)) {
      return `${safeEmoji(E.wrong || E.error, '❌')} Only admins or owners can use the **by** option.`;
    }

    const reservedBy = byUser?.id || interaction.user.id;
    const userId = byUser?.id || getUserId(interaction);
    const teamRows = await getTeamRows();
    const fixtureRows = await getFixtureRows(competition.fixturesRange);

    const fixtureRow = fixtureRows.find(row => normalizeMatchNo(row[competition.matchNoIndex]) === normalizeMatchNo(matchNo));
    if (!fixtureRow) {
      return `${safeEmoji(E.wrong || E.error, '❌')} Could not find fixture **${matchNo}** in the ${competition.label} fixtures sheet.`;
    }

    const homeTeam = clean(fixtureRow[competition.homeIndex]);
    const awayTeam = clean(fixtureRow[competition.awayIndex]);

    if (!homeTeam || !awayTeam) {
      return `${safeEmoji(E.wrong || E.error, '❌')} Fixture **${matchNo}** is missing home or away team data.`;
    }

    if (!isOwner(interaction) && !isCaptainOfEitherTeam(teamRows, userId, homeTeam, awayTeam)) {
      return `${safeEmoji(E.wrong || E.error, '❌')} Only the captain of one of the teams in fixture **${matchNo}** can reserve it. Owners can bypass this check.`;
    }

    const rows = await getReserveRows();
    const duplicateByMatch = rows.find(row => normalizeMatchNo(row[1]) === normalizeMatchNo(matchNo) && normalize(row[0]) === normalize(competition.reserveLabel));
    if (duplicateByMatch) {
      return `${safeEmoji(E.wrong || E.error, '❌')} Match **${matchNo}** is already reserved.`;
    }

    const activeCount = countActiveReservesByUser(rows, reservedBy);
    if (activeCount >= MAX_ACTIVE_RESERVES_PER_CAPTAIN) {
      return `${safeEmoji(E.wrong || E.error, '❌')} You already have **${MAX_ACTIVE_RESERVES_PER_CAPTAIN}** active reserves. Play one of them first so it gets removed, then reserve another.`;
    }

    pendingReserves.set(interaction.user.id, {
      matchNo,
      competition,
      homeTeam,
      awayTeam,
      reservedBy,
      playerName,
    });

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle(`${safeEmoji(E.calendar, '📅')} Reserve Preview`)
          .setDescription(buildReservePreviewDescription(matchNo, competition, activeCount))
          .addFields(
            { name: 'Competition', value: competition.label, inline: true },
            { name: 'Match No.', value: matchNo, inline: true },
            { name: 'Home Team', value: homeTeam, inline: true },
            { name: 'Away Team', value: awayTeam, inline: true },
            { name: 'By', value: `<@${reservedBy}>`, inline: true },
            { name: 'Player Name', value: playerName || 'N/A', inline: true },
            { name: 'Active Reserves', value: `${activeCount}/${MAX_ACTIVE_RESERVES_PER_CAPTAIN}`, inline: true }
          )
          .setColor(0xF1C40F)
          .setFooter({ text: 'Reserve Preview • Confirm to save or cancel to discard' })
          .setTimestamp()
      ],
      components: [buildButtons()]
    };
  },

  async buttonHandler(interaction, action) {
    // Handle pagination for reserve list
    const actionId = String(action || interaction.customId || '');

    if (
      actionId.includes('reserve_page_') ||
      actionId.startsWith('page_') ||
      actionId.startsWith('reserve_page_')
    ) {
      const match = actionId.match(/reserve_page_(\d+)|page_(\d+)/);
      const page = Number(match?.[1] || match?.[2] || 0);
      const rows = await getReserveRows();
      const totalPages = Math.max(1, Math.ceil(rows.length / RESERVES_PER_PAGE));

      return {
        embeds: [await buildReserveListEmbed(page)],
        components: [buildReservePageButtons(page, totalPages)]
      };
    }

    // Everything below is for reserve preview confirm/cancel
    const pending = pendingReserves.get(interaction.user.id);

    if (!pending) {
      return {
        embeds: [
          new EmbedBuilder()
            .setTitle(`${safeEmoji(E.wrong || E.error, '❌')} No Pending Reserve`)
            .setDescription('There is no pending reserve preview to confirm.')
            .setColor(0xE74C3C)
        ],
        components: []
      };
    }

    if (action === 'cancel') {
      pendingReserves.delete(interaction.user.id);
      return {
        embeds: [
          new EmbedBuilder()
            .setTitle(`${safeEmoji(E.wrong || E.error, '❌')} Reserve Cancelled`)
            .setDescription('The reserve preview was cancelled.')
            .setColor(0x95A5A6)
        ],
        components: []
      };
    }

    const rows = await getReserveRows();
    const duplicateByMatch = rows.find(row => normalizeMatchNo(row[1]) === normalizeMatchNo(pending.matchNo) && normalize(row[0]) === normalize(pending.competition.reserveLabel));
    if (duplicateByMatch) {
      pendingReserves.delete(interaction.user.id);
      return {
        embeds: [
          new EmbedBuilder()
            .setTitle(`${safeEmoji(E.wrong || E.error, '❌')} Already Reserved`)
            .setDescription(`Match **${pending.matchNo}** is already reserved.`)
            .setColor(0xE74C3C)
        ],
        components: []
      };
    }

    await appendData(RESERVE_SHEET_RANGE, [[
      pending.competition.reserveLabel,
      pending.matchNo,
      pending.homeTeam,
      pending.awayTeam,
      pending.reservedBy,
      pending.playerName || ''
    ]]);

    try {
      const fixtureData = await getData(
        pending.competition.fixturesRange,
        { cache: false }
      ).catch(() => []);

      if (Array.isArray(fixtureData) && fixtureData.length > 1) {
        const fixtureRows = fixtureData.slice(1);
        const fixtureIndex = fixtureRows.findIndex(
          row =>
            normalizeMatchNo(
              row[pending.competition.matchNoIndex]
            ) === normalizeMatchNo(pending.matchNo)
        );

        if (fixtureIndex !== -1) {
          const statusIndex =
            pending.competition.key === 'league' || pending.competition.fixturesRange.includes('A:J')
              ? 9
              : 10;

          fixtureRows[fixtureIndex][statusIndex] = 'Reserved';

          await updateData(
            `${pending.competition.fixturesRange.split('!')[0]}!A2:${pending.competition.fixturesRange.split(':')[1]}`,
            fixtureRows
          );
        }
      }
    } catch (err) {
      console.error('Reserve status update failed:', err);
    }
    invalidateSheetCache(['Reserve!']);
    pendingReserves.delete(interaction.user.id);

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle(`${safeEmoji(E.confirm, '✅')} Match Reserved`)
          .setDescription(buildReserveSuccessDescription(pending))
          .setColor(0x2ECC71)
          .setFooter({ text: 'Reserve Saved • Reserve sheet updated successfully' })
          .setTimestamp()
      ],
      components: []
    };
  }
};
