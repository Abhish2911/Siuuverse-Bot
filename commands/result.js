const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getData, updateData } = require('../utils/sheets');
const {
  buildMixedPrefixList,
  invalidateSheetCache,
  sendAuditLog,
  getAllowedMatchday,
  getCompetitionConfig
} = require('../utils/helpers');
const { refreshLiveStandings } = require('../utils/liveStandings');

let addYellowCard = async () => null;
let addRedCard = async () => null;
let assignNextBannedMatch = async () => null;

try {
  ({ addYellowCard, addRedCard, assignNextBannedMatch } = require('../utils/suspensionService'));
} catch (error) {
  console.warn('Suspension service unavailable:', error.message);
}

const E = require('../utils/emojis');

const pendingResults = new Map();
const PENDING_TTL = 5 * 60 * 1000;
const RESERVE_SHEET_RANGE = 'Reserve!A:F';
const SUBMITTED_AT_INDEX = 18;

const ALL_RESULT_SOURCES = [
  { key: 'league', label: 'League', range: 'Matches_Entry!A:S' },
  { key: 'ucl', label: 'UCL', range: 'UCL_Coop_Results!A:S' },
  { key: 'fa', label: 'FA Cup', range: 'FA_Cup_Coop_Results!A:S' },
  { key: 'carabao', label: 'Carabao Cup', range: 'Carabao_Coop_Results!A:S' }
];

function cleanPending(map) {
  const now = Date.now();

  for (const [k, v] of map.entries()) {
    if (!v?.createdAt || now - v.createdAt > PENDING_TTL) {
      map.delete(k);
    }
  }
}

function safeEmoji(v, f = '') {
  return v || f;
}

function clean(v) {
  return String(v || '').trim();
}

function normalizeMatchNo(v) {
  return String(v ?? '')
    .trim()
    .toUpperCase();
}

function getMatchdayKey(matchNo) {
  const value = normalizeMatchNo(matchNo);

  // League: L-1-1 -> L-1
  const league = value.match(/^L-(\d+)-\d+$/);
  if (league) {
    return `L-${league[1]}`;
  }

  // FA Cup: FA-R1-1 -> FA-R1
  const fa = value.match(/^FA-(.+?)-\d+$/);
  if (fa) {
    return `FA-${fa[1]}`;
  }

  // Carabao Cup: CB-R1-1 -> CB-R1
  const carabao = value.match(/^CB-(.+?)-\d+$/);
  if (carabao) {
    return `CB-${carabao[1]}`;
  }

  // UCL Group Stage: UCL-GS-A-1-1 -> UCL-GS-1
  const uclGroup = value.match(/^UCL-GS-[A-H]-(\d+)-\d+$/);
  if (uclGroup) {
    return `UCL-GS-${uclGroup[1]}`;
  }

  // UCL Knockout: UCL-R16-1 -> UCL-R16
  const uclKnockout = value.match(/^UCL-(R16|QF|SF|F)-\d+$/);
  if (uclKnockout) {
    return `UCL-${uclKnockout[1]}`;
  }

  return value;
}

function getTodayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function getSubmittedDateKey(v) {
  const d = new Date(String(v || '').trim());

  return Number.isNaN(d.getTime())
    ? ''
    : getTodayKey(d);
}

function sameTeam(a, b) {
  return clean(a).toLowerCase() === clean(b).toLowerCase();
}

function splitRawEntries(v) {
  return String(v || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
}

function compactList(v, empty = 'None') {
  const text = String(v || '').trim();

  if (!text) return empty;

  return text
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
    .map(x => `• ${x}`)
    .join('\n') || empty;
}

function compactCountList(v, empty = 'None') {
  const arr = splitRawEntries(v);

  if (!arr.length) return empty;

  const map = new Map();

  for (const x of arr) {
    map.set(x, (map.get(x) || 0) + 1);
  }

  return [...map.entries()]
    .map(([n, c]) => `• ${n} (${c})`)
    .join('\n') || empty;
}

function repeatedCount(v) {
  return splitRawEntries(v).length;
}

/* ---------------- DAILY LIMITS ---------------- */

function envNumber(n, f) {
  const v = Number(process.env[n]);

  return Number.isFinite(v) ? v : f;
}

function getCompetitionDailyLimit(k) {
  if (k === 'league') {
    return envNumber('MAX_LEAGUE_RESULTS_PER_TEAM_PER_DAY', 3);
  }

  if (k === 'ucl') {
    return envNumber('MAX_UCL_RESULTS_PER_TEAM_PER_DAY', 2);
  }

  return envNumber('MAX_CUP_RESULTS_PER_TEAM_PER_DAY', 2);
}

function getTotalDailyLimit() {
  return envNumber('MAX_TOTAL_RESULTS_PER_TEAM_PER_DAY', 4);
}

async function getDailyResultCounts({
  homeTeam,
  awayTeam,
  currentMatchNo
}) {
  const today = getTodayKey();

  const counts = {
    home: {
      total: 0,
      league: 0,
      ucl: 0,
      fa: 0,
      carabao: 0
    },
    away: {
      total: 0,
      league: 0,
      ucl: 0,
      fa: 0,
      carabao: 0
    }
  };

  const sheets = await Promise.all(
    ALL_RESULT_SOURCES.map(async s => {
      try {
        const rows = await getData(s.range);

        return {
          ...s,
          rows: Array.isArray(rows) ? rows.slice(1) : []
        };
      } catch {
        return {
          ...s,
          rows: []
        };
      }
    })
  );

  for (const s of sheets) {
    for (const r of s.rows) {
      if (normalizeMatchNo(r[0]) === currentMatchNo) continue;

      if (getSubmittedDateKey(r[SUBMITTED_AT_INDEX]) !== today) continue;

      const rh = clean(r[1]);
      const ra = clean(r[2]);

      if (sameTeam(rh, homeTeam) || sameTeam(ra, homeTeam)) {
        counts.home.total++;
        counts.home[s.key]++;
      }

      if (sameTeam(rh, awayTeam) || sameTeam(ra, awayTeam)) {
        counts.away.total++;
        counts.away[s.key]++;
      }
    }
  }

  return counts;
}

async function checkDailyResultLimit({
  competition,
  homeTeam,
  awayTeam,
  matchNo
}) {
  const compLimit = getCompetitionDailyLimit(competition.key);
  const totalLimit = getTotalDailyLimit();

  const counts = await getDailyResultCounts({
    homeTeam,
    awayTeam,
    currentMatchNo: matchNo
  });

  for (const side of ['home', 'away']) {
    const c = counts[side];

    if (compLimit && c[competition.key] >= compLimit) {
      return {
        ok: false,
        team: side,
        reason: `${side} reached ${compLimit} ${competition.label} submissions today.`
      };
    }

    if (totalLimit && c.total >= totalLimit) {
      return {
        ok: false,
        team: side,
        reason: `${side} reached total daily submission limit (${totalLimit}).`
      };
    }
  }

  return { ok: true };
}

/* ---------------- EXPORT ---------------- */

module.exports = {
  data: new SlashCommandBuilder()
    .setName('result')
    .setDescription('Submit match result')
    .addStringOption(o =>
      o.setName('match')
        .setDescription('Match number')
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName('homegoals')
        .setDescription('Home goals')
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName('awaygoals')
        .setDescription('Away goals')
        .setRequired(true)
    )
    .addStringOption(o => o.setName('scorers').setDescription('Comma separated scorers'))
    .addStringOption(o => o.setName('assists').setDescription('Comma separated assists'))
    .addStringOption(o => o.setName('yellow').setDescription('Yellow cards'))
    .addStringOption(o => o.setName('red').setDescription('Red cards'))
    .addStringOption(o => o.setName('mvp').setDescription('MVP'))
    .addStringOption(o =>
      o.setName('hometackles')
        .setDescription('Home team tackles')
    )
    .addStringOption(o =>
      o.setName('awaytackles')
        .setDescription('Away team tackles')
    )
    .addStringOption(o =>
      o.setName('homeinterceptions')
        .setDescription('Home team interceptions')
    )
    .addStringOption(o =>
      o.setName('awayinterceptions')
        .setDescription('Away team interceptions')
    )
    .addIntegerOption(o =>
      o.setName('homesaves')
        .setDescription('Home goalkeeper saves')
    )
    .addIntegerOption(o =>
      o.setName('awaysaves')
        .setDescription('Away goalkeeper saves')
    )
    .addStringOption(o =>
      o.setName('homeplayed')
        .setDescription('Home team players who played')
    )
    .addStringOption(o =>
      o.setName('awayplayed')
        .setDescription('Away team players who played')
    )
    .addStringOption(o =>
      o.setName('decision')
        .setDescription('Match decision (ET H, ET A, PENS H, PENS A)')
    ),

  async execute(interaction) {
    cleanPending(pendingResults);

    const matchNo = normalizeMatchNo(
      interaction.options.getString('match')
    );

    const hg = interaction.options.getInteger('homegoals');
    const ag = interaction.options.getInteger('awaygoals');

    const scorers = clean(interaction.options.getString('scorers'));
    const assists = clean(interaction.options.getString('assists'));
    const yellow = clean(interaction.options.getString('yellow'));
    const red = clean(interaction.options.getString('red'));
    const mvp = clean(interaction.options.getString('mvp'));
    const decision = clean(interaction.options.getString('decision'));

    const competition = getCompetitionConfig(matchNo);

    if (!competition) {
      return {
        content: `${safeEmoji(E.wrong, '❌')} Invalid match number.`
      };
    }

    const fixtures = await getData(competition.fixturesRange);

    if (competition.key === 'ucl') {
      const rowsForLock = Array.isArray(fixtures) ? fixtures.slice(1) : [];

      const grouped = new Map();

      for (const row of rowsForLock) {
        const match = normalizeMatchNo(row[0]);
        const md = getMatchdayKey(match);

        if (!grouped.has(md)) grouped.set(md, []);
        grouped.get(md).push(row);
      }

      const ordered = [...grouped.keys()].sort();

      let active = null;

      for (const md of ordered) {
        const matches = grouped.get(md) || [];

        const completed = matches.filter(
          r => r[4] !== '' && r[4] !== undefined && r[5] !== '' && r[5] !== undefined
        );

        if (completed.length < matches.length) {
          active = md;
          break;
        }
      }

      if (active) {
        fixtures.__allowedMatchday = active;
      }
    }

    if (fixtures.__allowedMatchday) {
      fixtures.allowedMatchday = fixtures.__allowedMatchday;
    }

    if (!Array.isArray(fixtures) || fixtures.length <= 1) {
      return {
        content: `${safeEmoji(E.wrong, '❌')} Fixtures unavailable.`
      };
    }

    const rows = fixtures.slice(1);

    const index = rows.findIndex(
      r => normalizeMatchNo(r[0]) === matchNo
    );

    if (index === -1) {
      return {
        content: `${safeEmoji(E.wrong, '❌')} Match not found.`
      };
    }

    const fixture = rows[index];

    const allowedMatchday = getAllowedMatchday(fixtures);

    if (allowedMatchday) {
      const requestedMatchday = getMatchdayKey(matchNo);

      if (
        normalizeMatchNo(requestedMatchday) !==
        normalizeMatchNo(allowedMatchday)
      ) {
        return {
          content:
            `${safeEmoji(E.lock, '🔒')} Results are currently locked. ` +
            `Only fixtures from **${allowedMatchday}** can be submitted right now.`
        };
      }
    }

    const homeTeam = clean(fixture[2]);
    const awayTeam = clean(fixture[3]);

    const limitCheck = await checkDailyResultLimit({
      competition,
      homeTeam,
      awayTeam,
      matchNo
    });

    if (!limitCheck.ok) {
      return {
        content: `${safeEmoji(E.lock, '🔒')} ${limitCheck.reason}`
      };
    }

    pendingResults.set(interaction.user.id, {
      matchNo,
      competition,
      fixtureIndex: index,
      hg,
      ag,
      homeTeam,
      awayTeam,
      scorers,
      assists,
      yellow,
      red,
      mvp,
      decision,
      resultText: hg > ag ? 'H' : hg < ag ? 'A' : 'D',
      createdAt: Date.now()
    });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`result_confirm_${matchNo}`)
        .setLabel('Confirm')
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId('result_cancel_keep')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

    return {
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle(`${safeEmoji(E.correct, '✅')} Preview Result`)
          .setDescription(
            `## ${homeTeam} ${hg} - ${ag} ${awayTeam}`
          )
          .addFields(
            {
              name: `${safeEmoji(E.goal, '⚽')} Scorers`,
              value: compactCountList(scorers),
              inline: true
            },
            {
              name: `${safeEmoji(E.assist, '🎯')} Assists`,
              value: compactCountList(assists),
              inline: true
            },
            {
              name: `${safeEmoji(E.mvp, '⭐')} MVP`,
              value: mvp || 'None',
              inline: true
            },
            {
              name: `${safeEmoji(E.yellow, '🟨')} Yellow Cards`,
              value: compactList(yellow),
              inline: true
            },
            {
              name: `${safeEmoji(E.red, '🟥')} Red Cards`,
              value: compactList(red),
              inline: true
            },
            {
              name: `${safeEmoji(E.info, '📌')} Competition`,
              value: competition.label || competition.key,
              inline: true
            }
          )
          .setFooter({
            text: 'Press Confirm to submit result'
          })
      ],
      components: [row]
    };
  },

  async buttonHandler(interaction, action) {
    cleanPending(pendingResults);

    if (action === 'cancel') {
      pendingResults.delete(interaction.user.id);

      return {
        content: `${safeEmoji(E.correct, '✅')} Result submission cancelled.`,
        components: [],
        embeds: []
      };
    }

    const pending = pendingResults.get(interaction.user.id);

    if (!pending) {
      return {
        content: `${safeEmoji(E.wrong, '❌')} Result submission expired.`,
        components: [],
        embeds: []
      };
    }

    const sheet = await getData(pending.competition.resultsRange);

    const rows = Array.isArray(sheet)
      ? sheet.slice(1)
      : [];

    const submittedAt = new Date().toISOString();

    const newRow = [
      pending.matchNo,
      pending.homeTeam,
      pending.awayTeam,
      pending.hg,
      pending.ag,
      pending.resultText,
      pending.scorers,
      pending.assists,
      pending.yellow,
      pending.red,
      pending.mvp,
      '',
      '',
      '',
      '',
      '',
      pending.decision,
      interaction.user.tag,
      submittedAt
    ];

    const i = rows.findIndex(
      r => normalizeMatchNo(r[0]) === pending.matchNo
    );

    if (i === -1) {
      rows.push(newRow);
    } else {
      rows[i] = newRow;
    }

    await updateData(
      `${pending.competition.resultsRange.split('!')[0]}!A2:S`,
      rows
    );

    invalidateSheetCache([
      pending.competition.resultsRange.split('!')[0]
    ]);

    try {
      await refreshLiveStandings(pending.competition.key);
    } catch (err) {
      console.error('Live standings refresh failed:', err);
    }

    try {
      if (pending.yellow) {
        for (const player of splitRawEntries(pending.yellow)) {
          await addYellowCard(player, pending.matchNo);
        }
      }

      if (pending.red) {
        for (const player of splitRawEntries(pending.red)) {
          await addRedCard(player, pending.matchNo);
          await assignNextBannedMatch(player);
        }
      }
    } catch (err) {
      console.error('Suspension update failed:', err);
    }

    sendAuditLog(interaction, {
      title: '📋 Match Result Submitted',
      color: 0x2ECC71,
      fields: [
        {
          name: 'Match',
          value: pending.matchNo,
          inline: true
        },
        {
          name: 'Score',
          value: `${pending.homeTeam} ${pending.hg}-${pending.ag} ${pending.awayTeam}`,
          inline: true
        },
        {
          name: 'Competition',
          value: pending.competition.label || pending.competition.key,
          inline: true
        }
      ]
    });

    pendingResults.delete(interaction.user.id);

    return {
      embeds: [
        new EmbedBuilder()
          .setColor(0x2ECC71)
          .setTitle(`${safeEmoji(E.correct, '✅')} Result Submitted`)
          .setDescription(
            `## ${pending.homeTeam} ${pending.hg} - ${pending.ag} ${pending.awayTeam}`
          )
          .addFields(
            {
              name: `${safeEmoji(E.goal, '⚽')} Goals`,
              value: String(
                repeatedCount(pending.scorers)
              ),
              inline: true
            },
            {
              name: `${safeEmoji(E.assist, '🎯')} Assists`,
              value: String(
                repeatedCount(pending.assists)
              ),
              inline: true
            },
            {
              name: `${safeEmoji(E.mvp, '⭐')} MVP`,
              value: pending.mvp || 'None',
              inline: true
            }
          )
          .setFooter({
            text: `${pending.competition.label || pending.competition.key} • Saved successfully`
          })
      ],
      components: []
    };
  }
};
