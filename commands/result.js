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
const { refreshLiveStandings2 } = require('../utils/liveStandings2');


const E = require('../utils/emojis');

const pendingResults = new Map();
function getPendingKey(userId, matchNo = '') {
  return `${userId}:${normalizeMatchNo(matchNo)}`;
}
const PENDING_TTL = 15 * 60 * 1000;
const RESERVE_SHEET_RANGE = 'Reserve!A:F';
const SUBMITTED_AT_INDEX = 18;

const ALL_RESULT_SOURCES = [
  { key: 'league', label: 'League', range: 'Matches_Entry!A:T' },
  { key: 'ucl', label: 'UCL', range: 'UCL_Coop_Results!A:T' },
  { key: 'fa', label: 'FA Cup', range: 'FA_Cup_Coop_Results!A:T' },
  { key: 'carabao', label: 'Carabao Cup', range: 'Carabao_Coop_Results!A:T' }
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
    .map(([n, c]) => c > 1 ? `• ${n} (${c})` : `• ${n}`)
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
    const homeTackles = clean(interaction.options.getString('hometackles'));
    const awayTackles = clean(interaction.options.getString('awaytackles'));
    const homeInterceptions = clean(interaction.options.getString('homeinterceptions'));
    const awayInterceptions = clean(interaction.options.getString('awayinterceptions'));
    const homeSaves = interaction.options.getInteger('homesaves') ?? '';
    const awaySaves = interaction.options.getInteger('awaysaves') ?? '';
    const homePlayed = clean(interaction.options.getString('homeplayed'));
    const awayPlayed = clean(interaction.options.getString('awayplayed'));

    const competition = getCompetitionConfig(matchNo);

    if (!competition) {
      return {
        content: `${safeEmoji(E.wrong, '❌')} Invalid match number.`
      };
    }

    const fixtures = await getData(competition.fixturesRange);

    if (!Array.isArray(fixtures) || fixtures.length <= 1) {
      return {
        content: `${safeEmoji(E.wrong, '❌')} Fixtures unavailable.`
      };
    }

    const rows = fixtures.slice(1);
    // const matchNoIndex = pendingResults.get(interaction.user.id)?.competition?.matchNoIndex ?? competition.matchNoIndex ?? 0;

    const index = rows.findIndex(
      r => normalizeMatchNo(r[competition.matchNoIndex ?? 0]) === matchNo
    );

    if (index === -1) {
      return {
        content: `${safeEmoji(E.wrong, '❌')} Match not found.`
      };
    }

    const fixture = rows[index];
    const homeTeam = clean(fixture[competition.homeIndex ?? 2]);
    const awayTeam = clean(fixture[competition.awayIndex ?? 3]);

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

    pendingResults.set(getPendingKey(interaction.user.id, matchNo), {
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
      homeTackles,
      awayTackles,
      homeInterceptions,
      awayInterceptions,
      homeSaves,
      awaySaves,
      homePlayed,
      awayPlayed,
      decision,
      resultText: hg > ag ? 'H' : hg < ag ? 'A' : 'D',
      createdAt: Date.now(),
      ownerId: interaction.user.id
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
          .setTitle(`${safeEmoji(E.correct, '✅')} Match Result Preview`)
          .setDescription(
            [
              `# ${safeEmoji(E.trophy, '🏆')} MATCH CENTRE`,
              '',
              `### ${safeEmoji(E.team, '🏠')} ${homeTeam}`,
              `# ${hg} - ${ag}`,
              `### ${safeEmoji(E.vs, '✈️')} ${awayTeam}`,
              '',
              `${safeEmoji(E.trophy, '🏆')} **${competition.label || competition.key}** • ${safeEmoji(E.calendar, '📋')} **${matchNo}**`
            ].join('\n')
          )
          .addFields(
            {
              name: `${safeEmoji(E.team, '🏠')} Home Team Stats`,
              value: [
                `${safeEmoji(E.tackle, '🛡️')} Tackles: ${homeTackles || '0'}`,
                `${safeEmoji(E.interception, '🚧')} Interceptions: ${homeInterceptions || '0'}`,
                `${safeEmoji(E.save, '🧤')} Saves: ${homeSaves || 0}`,
                `${safeEmoji(E.team, '👥')} Players Used: ${repeatedCount(homePlayed)}`
              ].join('\n'),
              inline: true
            },
            {
              name: `${safeEmoji(E.team, '🏠')} Away Team Stats`,
              value: [
                `${safeEmoji(E.tackle, '🛡️')} Tackles: ${awayTackles || '0'}`,
                `${safeEmoji(E.interception, '🚧')} Interceptions: ${awayInterceptions || '0'}`,
                `${safeEmoji(E.save, '🧤')} Saves: ${awaySaves || 0}`,
                `${safeEmoji(E.team, '👥')} Players Used: ${repeatedCount(awayPlayed)}`
              ].join('\n'),
              inline: true
            },
            {
              name: `${safeEmoji(E.mvp, '⭐')} Player of the Match`,
              value: mvp ? `${safeEmoji(E.mvp, '⭐')} **${mvp}**` : 'Not selected',
              inline: false
            },
            {
              name: `${safeEmoji(E.goal, '⚽')} Goalscorers`,
              value: compactCountList(scorers),
              inline: true
            },
            {
              name: `${safeEmoji(E.assist, '🎯')} Assists`,
              value: compactCountList(assists),
              inline: true
            },
            {
              name: `${safeEmoji(E.yellow, '🟨')} / ${safeEmoji(E.red, '🟥')} Discipline`,
              value: `${safeEmoji(E.yellow, '🟨')} Yellow Cards\n${compactList(yellow)}\n\n${safeEmoji(E.red, '🟥')} Red Cards\n${compactList(red)}`,
              inline: true
            }
          )
          .setFooter({
            text: 'Review carefully and press Confirm to submit.'
          })
          .setTimestamp()
      ],
      components: [row]
    };
  },

  async buttonHandler(interaction, action) {
    cleanPending(pendingResults);

    const matchNo = interaction.customId.startsWith('result_confirm_')
      ? normalizeMatchNo(interaction.customId.replace('result_confirm_', ''))
      : '';

    if (action === 'cancel') {
      for (const key of pendingResults.keys()) {
        if (key.startsWith(`${interaction.user.id}:`)) {
          pendingResults.delete(key);
        }
      }
      return {
        content: `${safeEmoji(E.correct, '✅')} Result submission cancelled.`,
        components: [],
        embeds: []
      };
    }

    let pending = pendingResults.get(
      getPendingKey(interaction.user.id, matchNo)
    );

    // Fallback lookup in case the key format changed, the interaction was
    // restored after a reload, or the match number casing differs.
    if (!pending && matchNo) {
      for (const [key, value] of pendingResults.entries()) {
        if (
          value &&
          normalizeMatchNo(value.matchNo) === matchNo &&
          key.startsWith(`${interaction.user.id}:`)
        ) {
          pending = value;
          break;
        }
      }
    }

    if (!pending) {
      return {
        content: `${safeEmoji(E.wrong, '❌')} Result submission not found. Please run /result again.`,
        components: [],
        embeds: []
      };
    }

    // Refresh TTL when user clicks confirm so long sheet operations do not
    // cause the submission to disappear during processing.
    pending.createdAt = Date.now();

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
      pending.scorers,
      pending.assists,
      pending.yellow,
      pending.red,
      pending.mvp,
      pending.homeTackles,
      pending.awayTackles,
      pending.homeInterceptions,
      pending.awayInterceptions,
      pending.homeSaves,
      pending.awaySaves,
      pending.homePlayed,
      pending.awayPlayed,
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

    // Update fixture sheet scores as well
    try {
      const fixtureSheet = await getData(pending.competition.fixturesRange);

      if (Array.isArray(fixtureSheet) && fixtureSheet.length > 1) {
        const fixtureRows = fixtureSheet.slice(1);

        const fixtureIndex = fixtureRows.findIndex(
          r => normalizeMatchNo(r[pending.competition.matchNoIndex ?? 0]) === pending.matchNo
        );

        if (fixtureIndex !== -1) {
          const isLeagueOrUclGroup = pending.competition.fixturesRange.includes('Fixtures!') || pending.competition.fixturesRange.includes('UCL_Coop_Group_Fixtures');

          const hgIndex = 4;
          const agIndex = 5;
          const resultIndex = 6;

          fixtureRows[fixtureIndex][hgIndex] = pending.hg;
          fixtureRows[fixtureIndex][agIndex] = pending.ag;

          fixtureRows[fixtureIndex][resultIndex] = pending.hg > pending.ag
            ? 'H'
            : pending.hg < pending.ag
              ? 'A'
              : 'D';

          if (!isLeagueOrUclGroup) {
            fixtureRows[fixtureIndex][7] = pending.decision || '';
          }

          await updateData(
            `${pending.competition.fixturesRange.split('!')[0]}!A2:${pending.competition.fixturesRange.split('!')[1].split(':')[1]}`,
            fixtureRows
          );
        }
      }
    } catch (err) {
      console.error('Fixture update failed:', err);
    }

    invalidateSheetCache([
      pending.competition.resultsRange.split('!')[0]
    ]);

    try {
      await refreshLiveStandings(pending.competition.key);

      await refreshLiveStandings2(
        interaction.client,
        interaction.guildId,
        'standings2'
      );

      await refreshLiveStandings2(
        interaction.client,
        interaction.guildId,
        'uclstandings2'
      );
    } catch (err) {
      console.error('Live standings refresh failed:', err);
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

    pendingResults.delete(
      getPendingKey(interaction.user.id, pending.matchNo)
    );

    return {
      embeds: [
        new EmbedBuilder()
          .setColor(0x2ECC71)
          .setTitle(`${safeEmoji(E.correct, '✅')} Match Result Submitted`)
          .setDescription(
            [
              `# ${safeEmoji(E.correct, '✅')} FULL TIME`,
              '',
              `### ${safeEmoji(E.team, '🏠')} ${pending.homeTeam}`,
              `# ${pending.hg} - ${pending.ag}`,
              `### ${safeEmoji(E.vs, '✈️')} ${pending.awayTeam}`,
              '',
              `${safeEmoji(E.trophy, '🏆')} **${pending.competition.label || pending.competition.key}** • ${safeEmoji(E.calendar, '📋')} **${pending.matchNo}**`
            ].join('\n')
          )
          .addFields(
            {
              name: `${safeEmoji(E.team, '🏠')} Home Team Stats`,
              value: [
                `${safeEmoji(E.tackle, '🛡️')} Tackles: ${pending.homeTackles || '0'}`,
                `${safeEmoji(E.interception, '🚧')} Interceptions: ${pending.homeInterceptions || '0'}`,
                `${safeEmoji(E.save, '🧤')} Saves: ${pending.homeSaves || 0}`,
                `${safeEmoji(E.team, '👥')} Players Used: ${repeatedCount(pending.homePlayed)}`
              ].join('\n'),
              inline: true
            },
            {
              name: `${safeEmoji(E.team, '🏠')} Away Team Stats`,
              value: [
                `${safeEmoji(E.tackle, '🛡️')} Tackles: ${pending.awayTackles || '0'}`,
                `${safeEmoji(E.interception, '🚧')} Interceptions: ${pending.awayInterceptions || '0'}`,
                `${safeEmoji(E.save, '🧤')} Saves: ${pending.awaySaves || 0}`,
                `${safeEmoji(E.team, '👥')} Players Used: ${repeatedCount(pending.awayPlayed)}`
              ].join('\n'),
              inline: true
            },
            {
              name: `${safeEmoji(E.mvp, '⭐')} Player of the Match`,
              value: pending.mvp ? `${safeEmoji(E.mvp, '⭐')} **${pending.mvp}**` : 'Not selected',
              inline: false
            },
            {
              name: `${safeEmoji(E.goal, '⚽')} Goalscorers`,
              value: compactCountList(pending.scorers),
              inline: true
            },
            {
              name: `${safeEmoji(E.assist, '🎯')} Assists`,
              value: compactCountList(pending.assists),
              inline: true
            },
            {
              name: `${safeEmoji(E.yellow, '🟨')} / ${safeEmoji(E.red, '🟥')} Discipline`,
              value: `${safeEmoji(E.yellow, '🟨')} Yellow Cards\n${compactList(pending.yellow)}\n\n${safeEmoji(E.red, '🟥')} Red Cards\n${compactList(pending.red)}`,
              inline: true
            }
          )
          .setFooter({
            text: `${pending.competition.label || pending.competition.key} • Result saved successfully`
          })
          .setTimestamp()
      ],
      components: []
    };
  }
};
