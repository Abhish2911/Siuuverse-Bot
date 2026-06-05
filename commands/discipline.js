const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { cachedGetData } = require('../utils/helpers');
const {
  getCompetitionSuspensions,
  getYellowThreshold,
  getCompetitionPhase
} = require('../utils/suspensionService');
const E = require('../utils/emojis');

const PER_PAGE = 5;
const SUSP_PER_PAGE = 4;

const padEnd = (value, len) => String(value ?? '').padEnd(len, ' ');
const padStart = (value, len) => String(value ?? '').padStart(len, ' ');
const shorten = (value, len) => {
  const str = String(value ?? '');
  return str.length > len ? `${str.slice(0, len - 1)}…` : str;
};

const safeEmoji = (value, fallback = '') => value || fallback;

function clean(value) {
  return String(value || '').trim();
}

function getRoundDisplayLabel(value) {
  const text = clean(value).toUpperCase();

  const gsMatch = text.match(/GS-[A-Z]-([0-9]+)-([0-9]+)/i);
  if (gsMatch) return `GS MD${gsMatch[1]}`;

  if (text.includes('QFQ')) return 'QFQ';
  if (text.includes('R1')) return 'R1';
  if (text.includes('R16') || text.includes('RO16')) return 'R16';
  if (text.includes('QF')) return 'QF';
  if (text.includes('SF')) return 'SF';
  if (text.includes('FINAL') || /\bF\b/.test(text)) return 'FINAL';
  if (text.includes('GS')) return 'GS';

  const mdMatch = text.match(/^(\d+)/);
  if (mdMatch) return `MD${mdMatch[1]}`;

  return text || '-';
}

function formatMatchDisplay(value) {
  const text = clean(value);
  if (!text || text === '-') return '-';

  const label = getRoundDisplayLabel(text);
  return label && label !== text.toUpperCase() ? `${text} (${label})` : text;
}

function getDisciplineMatchOrderValue(value) {
  const text = clean(value).toUpperCase();
  if (!text || text === '-') return Number.MAX_SAFE_INTEGER;

  const leagueMatch = text.match(/^(\d+)(?:[-.](\d+))?/);
  if (leagueMatch) {
    return (Number(leagueMatch[1]) || 0) * 100 + (Number(leagueMatch[2]) || 0);
  }

  const uclGsMatch = text.match(/GS-[A-Z]-([0-9]+)-([0-9]+)/i);

  if (uclGsMatch) {
    const md = Number(uclGsMatch[1]) || 0;
    const fixture = Number(uclGsMatch[2]) || 0;

    return 1000 + (md * 100) + fixture;
  }

  const stageMatch = text.match(/(GS|R1|R16|RO16|QFQ|QF|SF|FINAL|\bF\b)[^\d]*(\d+)?/i);
  if (stageMatch) {
    const stageKey = String(stageMatch[1] || '').toUpperCase();
    const stageMap = {
      GS: 10,
      R1: 15,
      R16: 20,
      RO16: 20,
      QFQ: 25,
      QF: 30,
      SF: 40,
      FINAL: 50,
      F: 50
    };

    return (stageMap[stageKey] || 99) * 100 + (Number(stageMatch[2]) || 0);
  }

  return Number.MAX_SAFE_INTEGER;
}

function getCompetitionConfig(key) {
  const normalized = clean(key || 'league').toLowerCase();

  if (normalized === 'fa') {
    return {
      key: 'fa',
      label: 'FA Cup',
      rankingYellowRange: 'FA_Cup_Coop_Ranking!H:I',
      rankingRedRange: 'FA_Cup_Coop_Ranking!K:L',
      fairPlayRange: 'Fair_Play!H:K',
      suspensionRange: 'FA_Cup_Coop_Suspension!A:G',
      footerText: 'FA Cup'
    };
  }

  if (normalized === 'carabao') {
    return {
      key: 'carabao',
      label: 'Carabao Cup',
      rankingYellowRange: 'Carabao_Coop_Ranking!H:I',
      rankingRedRange: 'Carabao_Coop_Ranking!K:L',
      fairPlayRange: 'Fair_Play!H:K',
      suspensionRange: 'Carabao_Coop_Suspension!A:G',
      footerText: 'Carabao Cup'
    };
  }

  if (normalized === 'ucl') {
    return {
      key: 'ucl',
      label: 'UCL',
      rankingYellowRange: 'UCL_Coop_Ranking!H:I',
      rankingRedRange: 'UCL_Coop_Ranking!K:L',
      fairPlayRange: 'Fair_Play!H:K',
      suspensionRange: 'UCL_Coop_Suspension!A:G',
      footerText: 'UCL'
    };
  }

  return {
    key: 'league',
    label: 'League',
    rankingYellowRange: 'Ranking!H:I',
    rankingRedRange: 'Ranking!K:L',
    fairPlayRange: 'Fair_Play!H:K',
    suspensionRange: 'Suspension!A:G',
    footerText: 'Coop league'
  };
}

function getSuspensionCurrentMatch(record) {
  return record?.bannedMatchNo || '-';
}

function buildMongoSuspensionRows(records) {
  return records.map(record => {
    const displayPlayer = record.teamShort
      ? `${record.teamShort}-${record.playerName || '-'}`
      : (record.playerName || '-');

    return [
      displayPlayer,
      record.yellowCards || 0,
      formatMatchDisplay(record.redMatchNo || '-'),
      formatMatchDisplay(record.yellowBanTriggeredAt || '-'),
      formatMatchDisplay(record.bannedMatchNo || '-'),
      record.status || '-',
      formatMatchDisplay(getSuspensionCurrentMatch(record))
    ];
  });
}

function buildMongoRiskRows(records, competitionKey) {
  return records
    .map(record => {
      const phase = getCompetitionPhase(
        competitionKey,
        record?.yellowBanTriggeredAt || record?.redMatchNo || record?.bannedMatchNo || ''
      );
      const threshold = getYellowThreshold(competitionKey, phase);
      const displayPlayer = record.teamShort
        ? `${record.teamShort}-${record.playerName || '-'}`
        : (record.playerName || '-');

      return {
        player: displayPlayer,
        yellowCards: record.yellowCards || 0,
        threshold,
        remaining: Math.max(0, threshold - (record.yellowCards || 0)),
        phase: getRoundDisplayLabel(phase || 'standard')
      };
    })
    .filter(row => row.yellowCards > 0 && row.remaining === 1);
}

function buildSheetSuspensionRows(data = []) {
  return data
    .slice(1)
    .filter(r => r[0] && r[5] && String(r[5]).toLowerCase().includes('suspend'))
    .sort((a, b) => getDisciplineMatchOrderValue(a[4]) - getDisciplineMatchOrderValue(b[4]))
    .map(row => {
      const next = [...row];
      next[2] = formatMatchDisplay(next[2]);
      next[3] = formatMatchDisplay(next[3]);
      next[4] = formatMatchDisplay(next[4]);
      return next;
    });
}

function buildAnsiTable(rows, columns) {
  const header = columns.map(col => padEnd(col.label, col.width)).join(' ');
  const body = rows.map(row => {
    const line = columns.map(col => padEnd(shorten(row[col.key] ?? '-', col.width), col.width)).join(' ');
    return `\u001b[1;31m${line}\u001b[0m`;
  }).join('\n');

  return `\`\`\`ansi\n${header}\n${body || 'No data'}\n\`\`\``;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('discipline')
    .setDescription('View coop league cards, fair play table, or suspensions')
    .addStringOption(opt =>
      opt
        .setName('type')
        .setDescription('Which discipline view to show')
        .setRequired(true)
        .addChoices(
          { name: 'Cards', value: 'cards' },
          { name: 'Fair Play', value: 'fairplay' },
          { name: 'Suspensions', value: 'suspension' }
        )
    )
    .addStringOption(opt =>
      opt
        .setName('competition')
        .setDescription('Competition to view discipline for')
        .setRequired(false)
        .addChoices(
          { name: 'League', value: 'league' },
          { name: 'FA Cup', value: 'fa' },
          { name: 'Carabao Cup', value: 'carabao' },
          { name: 'UCL', value: 'ucl' }
        )
    ),

  async execute(interaction) {
    const type = interaction.options.getString('type');
    const competitionKey = interaction.options.getString('competition') || 'league';

    if (type === 'cards') return buildCardsPage(0, competitionKey);
    if (type === 'fairplay') return buildFairPlay(competitionKey);
    if (type === 'suspension') return buildSuspensions(interaction, 0, competitionKey);

    return { content: '❌ Invalid discipline type.' };
  },

  async buttonHandler(interaction, section, action, page) {
    let newPage = parseInt(page, 10);
    if (Number.isNaN(newPage)) newPage = 0;

    if (action === 'prev') newPage--;
    if (action === 'next') newPage++;

    const [resolvedSection = section, competitionKey = 'league'] = String(section || '').split('__');

    if (resolvedSection === 'cards') return buildCardsPage(newPage, competitionKey);
    if (resolvedSection === 'suspension') return buildSuspensions(interaction, newPage, competitionKey);

    return { content: '❌ Invalid discipline action.', components: [] };
  }
};

async function buildCardsPage(page, competitionKey = 'league') {
  const competition = getCompetitionConfig(competitionKey);
  const yellow = await cachedGetData(competition.rankingYellowRange).catch(() => []);
  const red = await cachedGetData(competition.rankingRedRange).catch(() => []);

  const yRows = yellow.slice(2).filter(r => r[0] && r[1]);
  const rRows = red.slice(2).filter(r => r[0] && r[1]);

  const totalPages = Math.max(1, Math.ceil(Math.max(yRows.length, rRows.length) / PER_PAGE));
  page = Math.max(0, Math.min(page, totalPages - 1));

  const yPage = yRows.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  const rPage = rRows.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);

  const buildTable = (rows, label, offset) => {
    const header = ` # PLAYER         ${label}`;
    const body = rows.map((r, i) => {
      const rank = padStart(offset + i + 1, 2);
      const name = padEnd(shorten(r[0], 13), 13);
      const value = padStart(r[1], 3);
      return `${rank} ${name} ${value}`;
    }).join('\n');

    return `\`\`\`ini\n${header}\n${body || 'No data'}\n\`\`\``;
  };

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`discipline_cards__${competitionKey}_prev_${page}`)
      .setLabel('◀ Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),

    new ButtonBuilder()
      .setCustomId(`discipline_cards__${competitionKey}_next_${page}`)
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1)
  );

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`${safeEmoji(E.redCard, '🟥')} ${competition.label} Discipline Leaders`)
        .setDescription(
          `${competition.label} card leaders from player ranking data.\n` +
          `${competition.key === 'fa' || competition.key === 'carabao' ? 'Cup order: **R1 → QFQ → QF → SF → Final**.' : competition.key === 'ucl' ? 'UCL order: **GS → QF → SF → Final**.' : 'League order follows matchdays.'}`
        )
        .addFields(
          { name: `${safeEmoji(E.yellowCard, '🟨')} Yellow Cards`, value: buildTable(yPage, 'YC', page * PER_PAGE), inline: false },
          { name: `${safeEmoji(E.redCard, '🟥')} Red Cards`, value: buildTable(rPage, 'RC', page * PER_PAGE), inline: false },
          { name: `${safeEmoji(E.page || E.calendar, '📄')} Page`, value: `${page + 1}/${totalPages}`, inline: true },
          { name: `${safeEmoji(E.team, '👥')} Entries`, value: String(Math.max(yRows.length, rRows.length)), inline: true }
        )
        .setColor(0xE67E22)
        .setFooter({ text: `${competition.footerText} • Use buttons to view more card leaders` })
    ],
    components: [buttons]
  };
}

async function buildFairPlay(competitionKey = 'league') {
  const competition = getCompetitionConfig(competitionKey);
  const fairplay = await cachedGetData(competition.fairPlayRange).catch(() => []);
  const teams = await cachedGetData('Teams!A:C');

  if (!fairplay || fairplay.length <= 1) {
    return { content: `❌ No ${competition.label} fair play data found` };
  }

  const shortMap = {};
  teams.slice(1).forEach(row => {
    const teamName = row[0];
    const shortName = row[2];
    if (teamName && shortName) {
      shortMap[String(teamName).trim().toLowerCase()] = String(shortName).trim().toUpperCase();
    }
  });

  const rows = fairplay.slice(1).filter(r => r[0]);

  const table = rows.map((r, i) => {
    const fullTeam = String(r[0] || '').trim().toLowerCase();
    const tm = padEnd(shortMap[fullTeam] || String(r[0] || '').slice(0, 6).toUpperCase() || 'N/A', 6);
    const yc = padStart(r[1] || 0, 2);
    const rc = padStart(r[2] || 0, 2);
    const pts = padStart(r[3] || 0, 3);

    const line = `${padStart(i + 1, 2)} ${tm} ${yc} ${rc} ${pts}`;

    if (i < 3) return `+ ${line}`;
    if (i >= rows.length - 2) return `- ${line}`;
    return `  ${line}`;
  }).join('\n');

  const header = `   # TEAM   YC RC  PTS`;

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`${safeEmoji(E.fairPlay || E.fairplay, '🤝')} ${competition.label} Fair Play Table`)
        .setDescription(`\`\`\`diff\n${header}\n${table}\n\`\`\``)
        .addFields(
          { name: `${safeEmoji(E.team, '👥')} Teams`, value: String(rows.length), inline: true },
          { name: `${safeEmoji(E.info || E.calendar, '📌')} Rule`, value: 'Lower points is better', inline: true }
        )
        .setColor(0x2ECC71)
        .setFooter({ text: `${competition.footerText} • - Worst 2 • Lower is better` })
    ]
  };
}

async function buildSuspensions(interaction, page, competitionKey = 'league') {
  const competition = getCompetitionConfig(competitionKey);

  let suspendedRows = [];
  let riskRows = [];
  let sourceText = 'Sheets';

  const [sheetData, mongoRows] = await Promise.all([
    cachedGetData(competition.suspensionRange).catch(() => []),
    getCompetitionSuspensions(interaction.guild.id, competition.key).catch(() => [])
  ]);

  const sheetSuspendedRows = buildSheetSuspensionRows(Array.isArray(sheetData) ? sheetData : []);
  const allMongoRows = Array.isArray(mongoRows) ? mongoRows : [];
  const activeMongoRows = allMongoRows.filter(
    row => String(row?.status || '').toLowerCase() === 'suspended'
  );
  const atRiskMongoRows = buildMongoRiskRows(
    allMongoRows.filter(row => String(row?.status || '').toLowerCase() !== 'suspended'),
    competition.key
  );

  // Prefer Sheets for active suspensions so resetseason immediately reflects cleared data.
  // Use MongoDB primarily for one-card-away / at-risk tracking.
  if (sheetSuspendedRows.length) {
    suspendedRows = sheetSuspendedRows;
    sourceText = 'Sheets + Mongo risk';
  } else if (activeMongoRows.length) {
    suspendedRows = buildMongoSuspensionRows(activeMongoRows);
    sourceText = 'Mongo fallback';
  }

  riskRows = atRiskMongoRows;

  if (!suspendedRows.length && !riskRows.length) {
    return {
      embeds: [
        new EmbedBuilder()
          .setTitle(`${safeEmoji(E.ban || E.lock, '🚫')} ${competition.label} Discipline Watch`)
          .setDescription(
            `\`\`\`ini\nNo suspended or at-risk players right now.\n\`\`\`\n` +
            `${competition.key === 'fa' || competition.key === 'carabao' ? 'Cup discipline order: **R1 → QFQ → QF → SF → Final**.' : competition.key === 'ucl' ? 'UCL discipline order: **GS → QF → SF → Final**.' : 'League discipline order follows matchdays.'}`
          )
          .setColor(0xE74C3C)
          .setFooter({ text: `${competition.footerText} • All players available` })
      ]
    };
  }

  const totalPages = Math.max(1, Math.ceil(Math.max(suspendedRows.length, 1) / SUSP_PER_PAGE));
  page = Math.max(0, Math.min(page, totalPages - 1));

  const pageRows = suspendedRows.slice(page * SUSP_PER_PAGE, page * SUSP_PER_PAGE + SUSP_PER_PAGE);

  const suspendedTableRows = pageRows.map((r, i) => ({
    rank: padStart(page * SUSP_PER_PAGE + i + 1, 2),
    player: r[0] || '-',
    banMatch: formatMatchDisplay(r[4] || '-'),
    status: r[5] || '-'
  }));

  const suspendedTable = buildAnsiTable(suspendedTableRows, [
    { key: 'rank', label: '#', width: 2 },
    { key: 'player', label: 'PLAYER', width: 20 },
    { key: 'banMatch', label: 'BAN MATCH', width: 12 },
    { key: 'status', label: 'STATUS', width: 10 }
  ]);

  const riskTable = riskRows.length
    ? buildAnsiTable(
        riskRows.slice(0, 6).map((row, index) => ({
          rank: padStart(index + 1, 2),
          player: row.player,
          yellow: `${row.yellowCards}/${row.threshold}`,
          phase: row.phase,
          left: `${row.remaining} left`
        })),
        [
          { key: 'rank', label: '#', width: 2 },
          { key: 'player', label: 'AT RISK PLAYER', width: 20 },
          { key: 'yellow', label: 'YC', width: 4 },
          { key: 'phase', label: 'PHASE', width: 8 },
          { key: 'left', label: 'RISK', width: 8 }
        ]
      )
    : '\`\`\`ini\nNo one-card-away players right now.\n\`\`\`';

  const suspensionCards = pageRows.map((r, i) => {
    const player = r[0] || '-';
    const yellow = r[1] || 0;
    const redMatch = formatMatchDisplay(r[2] || '-');
    const yellowBan = formatMatchDisplay(r[3] || '-');
    const bannedMatch = formatMatchDisplay(r[4] || '-');

    return {
      name: `${safeEmoji(E.ban || E.lock, '🚫')} ${i + 1}. ${player}`,
      value:
        `${safeEmoji(E.yellowCard, '🟨')} **Yellow Cards:** ${yellow}\n` +
        `${safeEmoji(E.redCard, '🟥')} **Red Card Match:** ${redMatch}\n` +
        `${safeEmoji(E.ban || E.lock, '🚫')} **Yellow Trigger Match:** ${yellowBan}\n` +
        `${safeEmoji(E.ban || E.lock, '⛔')} **Next Banned Match:** ${bannedMatch}\n` +
        `${safeEmoji(E.info || E.Badge, '📌')} **Status:** ${r[5] || '-'}`,
      inline: true
    };
  });

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`discipline_suspension__${competitionKey}_prev_${page}`)
      .setLabel('◀ Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),

    new ButtonBuilder()
      .setCustomId(`discipline_suspension__${competitionKey}_next_${page}`)
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1)
  );

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`${safeEmoji(E.ban || E.lock, '🚫')} ${competition.label} Discipline Watch`)
        .setDescription(
          `${competition.key === 'fa' || competition.key === 'carabao' ? `${safeEmoji(E.rank, '🏅')} **Cup Order:** R1 → QFQ → QF → SF → Final\n` : competition.key === 'ucl' ? `${safeEmoji(E.UCL || E.trophy_animated, '🏆')} **UCL Order:** GS → QF → SF → Final\n` : ''}` +
          suspendedTable
        )
        .addFields(
          { name: `${safeEmoji(E.team, '📄')} Suspended`, value: String(suspendedRows.length), inline: true },
          { name: `${safeEmoji(E.yellowCard, '🟨')} At Risk`, value: String(riskRows.length), inline: true },
          { name: `${safeEmoji(E.page || E.calendar, '📄')} Page`, value: `${page + 1}/${totalPages}`, inline: true },
          { name: `${safeEmoji(E.warning || E.yellowCard, '⚠️')} One Card Away`, value: riskTable, inline: false },
          ...(suspensionCards.length
            ? [{ name: `${safeEmoji(E.profile, '📋')} Suspended Player Cards`, value: 'Detailed suspension data below.', inline: false }, ...suspensionCards]
            : [{ name: `${safeEmoji(E.profile, '📋')} Suspended Player Cards`, value: 'No active suspensions on this page.', inline: false }])
        )
        .setColor(0xE74C3C)
        .setFooter({ text: `${competition.footerText} • ${sourceText} • Suspended + At-risk view • QFQ supported` })
    ],
    components: [buttons]
  };
}
