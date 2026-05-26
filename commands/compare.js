const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { cachedGetData, getTeamColor } = require('../utils/helpers');
const E = require('../utils/emojis');

const normalize = (value) => String(value || '').toLowerCase().trim();
const stripTeamPrefix = (value) => {
  const text = String(value || '').trim();
  return text.includes('-') ? text.split('-').slice(1).join('-').trim() : text;
};
const shorten = (value, len) => {
  const str = String(value || '');
  return str.length > len ? `${str.slice(0, len - 1)}…` : str;
};
const padEnd = (value, len) => String(value ?? '').padEnd(len, ' ');
const padStart = (value, len) => String(value ?? '').padStart(len, ' ');
const safeEmoji = (value, fallback = '') => value || fallback;

function safeCount(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function buildComparisonSummary(leftName, rightName, leftStats, rightStats, type) {
  const categories = type === 'player'
    ? [
        ['Played', leftStats.played, rightStats.played],
        ['Goals', leftStats.goals, rightStats.goals],
        ['Assists', leftStats.assists, rightStats.assists],
        ['G/A', leftStats.ga, rightStats.ga],
        ['MVP', leftStats.mvp, rightStats.mvp],
        ['Tackles', leftStats.tackles, rightStats.tackles],
        ['Interceptions', leftStats.interceptions, rightStats.interceptions]
      ]
    : [
        ['Played', leftStats.played, rightStats.played],
        ['Goals', leftStats.goals, rightStats.goals],
        ['Assists', leftStats.assists, rightStats.assists],
        ['G/A', leftStats.ga, rightStats.ga],
        ['MVP', leftStats.mvp, rightStats.mvp],
        ['Tackles', leftStats.tackles, rightStats.tackles],
        ['Interceptions', leftStats.interceptions, rightStats.interceptions],
        ['Saves', leftStats.saves, rightStats.saves],
        ['Yellow', leftStats.yellow, rightStats.yellow],
        ['Red', leftStats.red, rightStats.red]
      ];

  let leftWins = 0;
  let rightWins = 0;
  let draws = 0;

  for (const [, leftValue, rightValue] of categories) {
    if (safeCount(leftValue) > safeCount(rightValue)) leftWins += 1;
    else if (safeCount(rightValue) > safeCount(leftValue)) rightWins += 1;
    else draws += 1;
  }

  const leader = leftWins > rightWins
    ? leftName
    : rightWins > leftWins
      ? rightName
      : 'Level';

  return {
    leftWins,
    rightWins,
    draws,
    leader,
    totalCategories: categories.length
  };
}

function buildComparisonDescription(typeLabel, leftName, rightName, summary) {
  return (
    `${safeEmoji(E.vs, '⚔️')} **${typeLabel} Comparison**\n` +
    `${safeEmoji(E.profile, '👤')} **Left:** ${leftName}\n` +
    `${safeEmoji(E.profile, '👤')} **Right:** ${rightName}\n\n` +
    `${safeEmoji(E.goldenBoot || E.goal, '🏆')} **Category Wins:** ${summary.leftWins} - ${summary.rightWins}\n` +
    `${safeEmoji(E.draw, '🤝')} **Tied Categories:** ${summary.draws}\n` +
    `${safeEmoji(E.fire, '🔥')} **Overall Edge:** ${summary.leader}\n` +
    `${safeEmoji(E.rank, '🏅')} **Categories Compared:** ${summary.totalCategories}`
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('compare')
    .setDescription('Compare players or teams')
    .addStringOption(opt =>
      opt.setName('type')
        .setDescription('Comparison type')
        .setRequired(true)
        .addChoices(
          { name: 'Player', value: 'player' },
          { name: 'Team', value: 'team' }
        )
    )
    .addStringOption(opt =>
      opt.setName('name1')
        .setDescription('First player/team')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('name2')
        .setDescription('Second player/team')
        .setRequired(true)
    ),

  async execute(interaction) {
    const type = interaction.options.getString('type');
    const n1Input = interaction.options.getString('name1');
    const n2Input = interaction.options.getString('name2');

    const n1 = normalize(n1Input);
    const n2 = normalize(n2Input);

    const ranking = await cachedGetData('Ranking!A:AA');
    const teams = await cachedGetData('Teams!A:H');
    const matchesEntry = await cachedGetData('Matches_Entry!A:R');

    const rankingRows = Array.isArray(ranking)
      ? ranking.slice(2).filter(r => r && r.length)
      : [];

    const matchRows = Array.isArray(matchesEntry)
      ? matchesEntry.slice(1).filter(r => r && r.length)
      : [];

    const win = (a, b) => {
      if (a > b) return E.leftArrow || '⬅️';
      if (b > a) return E.rightArrow || '➡️';
      return E.equal;
    };

    const formatStatLine = (label, leftValue, rightValue) => {
      return `**${label}** • ${leftValue} ${win(leftValue, rightValue)} ${rightValue}`;
    };

    const getPlayerStat = (type, playerName) => {
      let nameIndex;
      let valueIndex;

      if (type === 'goals') {
        nameIndex = 1; valueIndex = 2;   // B:C
      } else if (type === 'assists') {
        nameIndex = 4; valueIndex = 5;   // E:F
      } else if (type === 'yellow') {
        nameIndex = 7; valueIndex = 8;   // H:I
      } else if (type === 'red') {
        nameIndex = 10; valueIndex = 11; // K:L
      } else if (type === 'mvp') {
        nameIndex = 13; valueIndex = 14; // N:O
      } else if (type === 'ga') {
        nameIndex = 16; valueIndex = 17; // Q:R
      } else if (type === 'tackles') {
        nameIndex = 19; valueIndex = 20; // T:U
      } else if (type === 'interceptions') {
        nameIndex = 22; valueIndex = 23; // W:X
      } else {
        return 0;
      }

      const row = rankingRows.find(r =>
        normalize(r[nameIndex]) === normalize(playerName) ||
        normalize(stripTeamPrefix(r[nameIndex])) === normalize(playerName)
      );
      return row ? Number(row[valueIndex]) || 0 : 0;
    };

    const getPlayerPlayed = (playerName) => {
      const target = normalize(playerName);
      if (!target) return 0;

      let count = 0;

      for (const row of matchRows) {
        const homeTeam = normalize(row[1]);
        const awayTeam = normalize(row[2]);
        const homePlayed = normalize(row[16]);
        const awayPlayed = normalize(row[17]);

        const allStatText = [row[5], row[6], row[7], row[8], row[9], row[10], row[11], row[12]]
          .map(v => normalize(v))
          .join(',');

        const appearedInStats = allStatText
          .split(',')
          .map(v => normalize(stripTeamPrefix(v)))
          .some(name => name === target);

        const playerWithPrefix = [row[5], row[6], row[7], row[8], row[9], row[10], row[11], row[12]]
          .map(v => normalize(v))
          .join(',');

        const appearedForHome = playerWithPrefix.includes(`${homeTeam}-`) && appearedInStats;
        const appearedForAway = playerWithPrefix.includes(`${awayTeam}-`) && appearedInStats;

        if (appearedForHome && homePlayed !== 'no') count += 1;
        else if (appearedForAway && awayPlayed !== 'no') count += 1;
        else if (appearedInStats) count += 1;
      }

      return count;
    };

    const getTeamSaves = (teamShort) => {
      const targetShort = normalize(teamShort);
      if (!targetShort) return 0;

      let total = 0;

      for (const row of matchRows) {
        const homeShort = normalize(row[1]);
        const awayShort = normalize(row[2]);

        if (homeShort === targetShort) {
          total += Number(row[14]) || 0;
        }

        if (awayShort === targetShort) {
          total += Number(row[15]) || 0;
        }
      }

      return total;
    };

    if (type === 'player') {
      const p1 = {
        played: getPlayerPlayed(n1),
        goals: getPlayerStat('goals', n1),
        assists: getPlayerStat('assists', n1),
        ga: getPlayerStat('ga', n1),
        mvp: getPlayerStat('mvp', n1),
        tackles: getPlayerStat('tackles', n1),
        interceptions: getPlayerStat('interceptions', n1)
      };

      const p2 = {
        played: getPlayerPlayed(n2),
        goals: getPlayerStat('goals', n2),
        assists: getPlayerStat('assists', n2),
        ga: getPlayerStat('ga', n2),
        mvp: getPlayerStat('mvp', n2),
        tackles: getPlayerStat('tackles', n2),
        interceptions: getPlayerStat('interceptions', n2)
      };

      const summary = buildComparisonSummary(n1Input, n2Input, p1, p2, 'player');

      const left = shorten(n1Input, 10);
      const right = shorten(n2Input, 10);

      return {
        embeds: [
          new EmbedBuilder()
            .setTitle(`${E.vs} Player Comparison`)
            .setDescription(buildComparisonDescription('Player', n1Input, n2Input, summary))
            .addFields(
              {
                name: `${safeEmoji(E.Stats || E.chart || E.rank, '📊')} Stats`,
                value:
                  `${formatStatLine('Played', p1.played, p2.played)}\n` +
                  `${formatStatLine('Goals', p1.goals, p2.goals)}\n` +
                  `${formatStatLine('Assists', p1.assists, p2.assists)}\n` +
                  `${formatStatLine('G/A', p1.ga, p2.ga)}\n` +
                  `${formatStatLine('MVP', p1.mvp, p2.mvp)}\n` +
                  `${formatStatLine('Tackles', p1.tackles, p2.tackles)}\n` +
                  `${formatStatLine('Interceptions', p1.interceptions, p2.interceptions)}`,
                inline: false
              },
              { name: '🏆 Left Wins', value: String(summary.leftWins), inline: true },
              { name: '🤝 Drawn Stats', value: String(summary.draws), inline: true },
              { name: '🏆 Right Wins', value: String(summary.rightWins), inline: true }
            )
            .setColor(0x5865F2)
            .setFooter({ text: 'Compare • Player view • Compact mobile comparison table' })
        ]
      };
    }

    const calcTeam = (teamName) => {
      const team = teams.slice(1).find(t => normalize(t[0]) === teamName || normalize(t[2]) === teamName);
      if (!team) return null;

      const short = normalize(team[2]);
      const players = String(team[1] || '')
        .split(',')
        .map(p => normalize(stripTeamPrefix(p)))
        .filter(Boolean);

      const total = {
        played: 0,
        goals: 0,
        assists: 0,
        ga: 0,
        mvp: 0,
        yellow: 0,
        red: 0,
        tackles: 0,
        interceptions: 0,
        saves: 0,
        short: team[2] || team[0]
      };

      for (const player of players) {
        total.played += getPlayerPlayed(player);
        total.goals += getPlayerStat('goals', player);
        total.assists += getPlayerStat('assists', player);
        total.ga += getPlayerStat('ga', player);
        total.mvp += getPlayerStat('mvp', player);
        total.tackles += getPlayerStat('tackles', player);
        total.interceptions += getPlayerStat('interceptions', player);
      }

      total.saves = getTeamSaves(team[2] || team[0]);

      for (const row of rankingRows) {
        const yellowName = normalize(row[7]);
        const yellowVal = Number(row[8]) || 0;
        const redName = normalize(row[10]);
        const redVal = Number(row[11]) || 0;

        if (yellowName && yellowName.startsWith(`${short}-`)) {
          total.yellow += yellowVal;
        }
        if (redName && redName.startsWith(`${short}-`)) {
          total.red += redVal;
        }
      }

      return total;
    };

    const team1 = calcTeam(n1);
    const team2 = calcTeam(n2);
    const summary = team1 && team2 ? buildComparisonSummary(n1Input, n2Input, team1, team2, 'team') : null;

    if (!team1 || !team2) {
      return { content: '❌ Team not found' };
    }

    const left = shorten(team1.short, 8);
    const right = shorten(team2.short, 8);

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle(`${E.vs} Team Comparison`)
          .setDescription(buildComparisonDescription('Team', n1Input, n2Input, summary))
          .addFields(
            {
              name: `${safeEmoji(E.Stats || E.chart || E.rank, '📊')} Team Stats`,
              value:
                `${formatStatLine('Played', team1.played, team2.played)}\n` +
                `${formatStatLine('Goals', team1.goals, team2.goals)}\n` +
                `${formatStatLine('Assists', team1.assists, team2.assists)}\n` +
                `${formatStatLine('G/A', team1.ga, team2.ga)}\n` +
                `${formatStatLine('MVP', team1.mvp, team2.mvp)}\n` +
                `${formatStatLine('Tackles', team1.tackles, team2.tackles)}\n` +
                `${formatStatLine('Interceptions', team1.interceptions, team2.interceptions)}\n` +
                `${formatStatLine('Saves', team1.saves, team2.saves)}\n` +
                `${formatStatLine('Yellow', team1.yellow, team2.yellow)}\n` +
                `${formatStatLine('Red', team1.red, team2.red)}`,
              inline: false
            },
            { name: '🏆 Left Wins', value: String(summary.leftWins), inline: true },
            { name: '🤝 Drawn Stats', value: String(summary.draws), inline: true },
            { name: '🏆 Right Wins', value: String(summary.rightWins), inline: true }
          )
          .setColor(getTeamColor(teams, n1Input, 0x5865F2))
          .setFooter({ text: 'Compare • Team view • Compact mobile comparison table' })
      ]
    };
  }
};