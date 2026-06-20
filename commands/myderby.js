const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const { cachedGetData } = require('../utils/helpers');
const E = require('../utils/emojis');

function clean(v) {
  return String(v || '').trim();
}

function safeEmoji(v, f = '') {
  return v || f;
}

function normalize(v) {
  return clean(v).toLowerCase();
}

function countEntries(text) {
  return clean(text)
    .split(',')
    .map(x => x.trim())
    .filter(Boolean).length;
}

function addPlayerStat(map, text, value = 1) {
  clean(text)
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
    .forEach(player => {
      const match = player.match(/^(.*?)\s*\((\d+)\)\s*$/);

      const name = (match ? match[1] : player).trim();
      const amount = match ? Number(match[2]) || 1 : value;

      if (!name) return;
      map.set(name, (map.get(name) || 0) + amount);
    });
}

async function getUserTeam(userId) {
  const teams = await cachedGetData('Teams!A:Z');

  for (const row of teams.slice(1)) {
    const captainId = clean(row[4]);
    const users = clean(row[5])
      .split(',')
      .map(x => x.trim());

    if (captainId === userId || users.includes(userId)) {
      return {
        teamName: clean(row[0]),
        shortName: clean(row[2])
      };
    }
  }

  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('myderby')
    .setDescription('View derby statistics for your team'),

  async execute(interaction) {
    const myTeam = await getUserTeam(interaction.user.id);

    if (!myTeam) {
      return {
        content: `${safeEmoji(E.wrong, '❌')} You are not assigned to any team.`
      };
    }

    const [
      derbiesSheet,
      league,
      fa,
      carabao,
      ucl,
      leagueFixtures,
      faFixtures,
      carabaoFixtures,
      uclFixtures
    ] = await Promise.all([
      cachedGetData('Derbies!A:D'),
      cachedGetData('Matches_Entry!A:S').catch(() => []),
      cachedGetData('FA_Cup_Coop_Results!A:S').catch(() => []),
      cachedGetData('Carabao_Coop_Results!A:S').catch(() => []),
      cachedGetData('UCL_Coop_Results!A:S').catch(() => []),
      cachedGetData('Fixtures!A:Z').catch(() => []),
      cachedGetData('FA_Cup_Fixtures!A:Z').catch(() => []),
      cachedGetData('Carabao_Fixtures!A:Z').catch(() => []),
      cachedGetData('UCL_Fixtures!A:Z').catch(() => [])
    ]);

    const derbyRow = derbiesSheet
      .slice(1)
      .find(row => {
        const t1 = normalize(row[1]);
        const t2 = normalize(row[2]);
        const active = normalize(row[3]);

        return (
          (
            normalize(myTeam.teamName) === t1 ||
            normalize(myTeam.teamName) === t2
          ) &&
          ['yes', 'active', 'true', '1'].includes(active)
        );
      });

    if (!derbyRow) {
      return {
        content: `${safeEmoji(E.wrong, '❌')} No active derby found for ${myTeam.teamName}.`
      };
    }

    const derbyName = clean(derbyRow[0]);
    const team1 = clean(derbyRow[1]);
    const team2 = clean(derbyRow[2]);

    const sources = [league, fa, carabao, ucl];
    const fixtureSources = [
      leagueFixtures,
      faFixtures,
      carabaoFixtures,
      uclFixtures
    ];

    let played = 0;
    let team1Wins = 0;
    let team2Wins = 0;
    let draws = 0;
    let team1Goals = 0;
    let team2Goals = 0;

    const goals = new Map();
    const assists = new Map();
    const mvps = new Map();

    for (const sheet of sources) {
      for (const row of (sheet || []).slice(1)) {
        const home = clean(row[1]);
        const away = clean(row[2]);

        const isDerby =
          (normalize(home) === normalize(team1) && normalize(away) === normalize(team2)) ||
          (normalize(home) === normalize(team2) && normalize(away) === normalize(team1));

        if (!isDerby) continue;

        const hg = Number(row[3] || 0);
        const ag = Number(row[4] || 0);

        played++;

        if (normalize(home) === normalize(team1)) {
          team1Goals += hg;
          team2Goals += ag;

          if (hg > ag) team1Wins++;
          else if (ag > hg) team2Wins++;
          else draws++;
        } else {
          team2Goals += hg;
          team1Goals += ag;

          if (hg > ag) team2Wins++;
          else if (ag > hg) team1Wins++;
          else draws++;
        }

        addPlayerStat(goals, row[5]);
        addPlayerStat(assists, row[6]);

        const mvp = clean(row[9]);
        if (mvp) {
          mvps.set(mvp, (mvps.get(mvp) || 0) + 1);
        }
      }
    }

    let nextDerby = null;

    for (const sheet of fixtureSources) {
      for (const row of (sheet || []).slice(1)) {
        const home = clean(row[2]);
        const away = clean(row[3]);

        const isDerbyFixture =
          (normalize(home) === normalize(team1) && normalize(away) === normalize(team2)) ||
          (normalize(home) === normalize(team2) && normalize(away) === normalize(team1));

        if (!isDerbyFixture) continue;

        const hg = clean(row[4]);
        const ag = clean(row[5]);

        if (hg || ag) continue;

        nextDerby = {
          matchNo: clean(row[0]),
          date: clean(row[1]),
          home,
          away
        };

        break;
      }

      if (nextDerby) break;
    }

    const topGoals = [...goals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([p, v]) => `• ${p} (${v})`)
      .join('\n') || 'None';

    const topAssists = [...assists.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([p, v]) => `• ${p} (${v})`)
      .join('\n') || 'None';

    const topMvps = [...mvps.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([p, v]) => `• ${p} (${v})`)
      .join('\n') || 'None';

    const embed = new EmbedBuilder()
      .setColor(0xE67E22)
      .setTitle(`${safeEmoji(E.fire, '🔥')} ${derbyName}`)
      .addFields(
        {
          name: `${safeEmoji(E.Stats, '📊')} Overall Record`,
          value:
            `${safeEmoji(E.played, '🎮')} Matches: **${played}**\n` +
            `${safeEmoji(E.win, '✅')} ${team1}: **${team1Wins}W**\n` +
            `${safeEmoji(E.win, '✅')} ${team2}: **${team2Wins}W**\n` +
            `${safeEmoji(E.draw, '🤝')} Draws: **${draws}**`
        },
        {
          name: `${safeEmoji(E.goal, '⚽')} Goals`,
          value:
            `${team1}: ${safeEmoji(E.goal, '⚽')} **${team1Goals}**\n` +
            `${team2}: ${safeEmoji(E.goal, '⚽')} **${team2Goals}**`
        },
        {
          name: `${safeEmoji(E.calendar, '📅')} Next Derby`,
          value: nextDerby
            ? `**${nextDerby.matchNo}**\n${nextDerby.date || 'TBD'}\n${nextDerby.home} vs ${nextDerby.away}`
            : 'No upcoming derby fixture found.'
        },
        {
          name: `${safeEmoji(E.goldenBoot, '🥇')} Top Scorers`,
          value: topGoals,
          inline: false
        },
        {
          name: `${safeEmoji(E.assist, '🎯')} Top Assists`,
          value: topAssists,
          inline: false
        },
        {
          name: `${safeEmoji(E.mvp, '⭐')} Top MVPs`,
          value: topMvps,
          inline: false
        }
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('myderby_refresh')
        .setLabel('Refresh')
        .setEmoji('🔄')
        .setStyle(ButtonStyle.Primary)
    );

    return {
      embeds: [embed],
      components: [row]
    };
  },

  async buttonHandler(interaction) {
    return module.exports.execute(interaction);
  }
};
