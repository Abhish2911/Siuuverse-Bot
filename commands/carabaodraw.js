const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { cachedGetData, invalidateSheetCache, sendAuditLog } = require('../utils/helpers');
const { updateData } = require('../utils/sheets');
const {
  clean,
  toNumber,
  getTeamsHeaderMap,
  getActiveTeamsByCompetition,
  sortTeamsByColumn
} = require('../utils/competitionHelpers');
const E = require('../utils/emojis');

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function isOwner(interaction) {
  const ownerIds = String(process.env.OWNER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  return ownerIds.includes(interaction.user.id) || interaction.guild?.ownerId === interaction.user.id;
}

function shuffleTeams(teams) {
  const copy = [...teams];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

function splitSeedsForCupFormat(seedRows) {
  return {
    top4: seedRows.filter(team => toNumber(team.seed) >= 1 && toNumber(team.seed) <= 4),
    round1: seedRows.filter(team => toNumber(team.seed) >= 5)
  };
}

function buildFixture(round, md, home, away, leg = '') {
  return {
    round: leg ? `${round} ${leg}` : round,
    md,
    date: '',
    homeTeam: home.teamName,
    awayTeam: away.teamName,
    hg: '',
    ag: '',
    result: '',
    decision: '',
    homeShort: home.shortName,
    awayShort: away.shortName,
    status: 'Upcoming'
  };
}

function pairSequentialTeams(teams, round, prefix, startNumber = 1, twoLegged = false) {
  const fixtures = [];
  let matchNo = startNumber;

  for (let i = 0; i < teams.length; i += 2) {
    const home = teams[i];
    const away = teams[i + 1];

    if (!home || !away) continue;

    if (twoLegged) {
      fixtures.push(
        buildFixture(round, `${prefix}-${matchNo}A`, home, away, 'Leg 1')
      );

      fixtures.push(
        buildFixture(round, `${prefix}-${matchNo}B`, away, home, 'Leg 2')
      );
    } else {
      fixtures.push(
        buildFixture(round, `${prefix}-${matchNo}`, home, away)
      );
    }

    matchNo++;
  }

  return fixtures;
}

function buildQfqFixtures(round1WinnerSlots) {
  const shuffled = shuffleTeams(round1WinnerSlots);

  const byeTeam = shuffled.pop();

  const fixtures = pairSequentialTeams(
    shuffled,
    'Quarter Final Qualifier',
    'CB QFQ'
  );

  return {
    fixtures,
    byeTeam
  };
}

function buildCarabaoDraw(seedRows) {
  const grouped = splitSeedsForCupFormat(seedRows);

  const shuffledRound1 = shuffleTeams(grouped.round1);

  const round1Fixtures = pairSequentialTeams(
    shuffledRound1,
    'Round 1',
    'CB R1'
  );

  const round1WinnerSlots = round1Fixtures.map((fixture, index) => ({
    teamName: `Winner ${fixture.md}`,
    shortName: `W${index + 1}`,
    seed: 100 + index
  }));

  const qfqDraw = buildQfqFixtures(round1WinnerSlots);

  const qfqWinnerSlots = qfqDraw.fixtures.map((fixture, index) => ({
    teamName: `Winner ${fixture.md}`,
    shortName: `QFQ${index + 1}`,
    seed: 200 + index
  }));

  const qfTeams = shuffleTeams([
    ...grouped.top4,
    ...qfqWinnerSlots,
    qfqDraw.byeTeam
  ].filter(Boolean));

  const qfFixtures = pairSequentialTeams(
    qfTeams,
    'Quarter Final',
    'CB QF',
    1,
    true
  );

  const sfSlots = [1, 2, 3, 4].map(n => ({
    teamName: `Winner CB QF-${n}`,
    shortName: `SF${n}`
  }));

  const sfFixtures = pairSequentialTeams(
    sfSlots,
    'Semi Final',
    'CB SF',
    1,
    true
  );

  const finalFixture = buildFixture(
    'Final',
    'CB Final',
    {
      teamName: 'Winner CB SF-1',
      shortName: 'F1'
    },
    {
      teamName: 'Winner CB SF-2',
      shortName: 'F2'
    }
  );

  return {
    grouped,
    qfqBye: qfqDraw.byeTeam,
    fixtures: [
      ...round1Fixtures,
      ...qfqDraw.fixtures,
      ...qfFixtures,
      ...sfFixtures,
      finalFixture
    ]
  };
}

function formatDrawLines(fixtures) {
  if (!fixtures.length) return ['No fixtures generated.'];

  const grouped = {};

  for (const fixture of fixtures) {
    const round = clean(fixture.round);

    if (!grouped[round]) grouped[round] = [];

    grouped[round].push(
      `\`${fixture.md}\` • \`${fixture.homeShort}\` ${safeEmoji(E.vs, '⚔️')} \`${fixture.awayShort}\``
    );
  }

  const fields = [];

  for (const [round, matches] of Object.entries(grouped)) {
    fields.push({
      name: `${safeEmoji(E.calendar, '📅')} ${round}`,
      value: matches.join('\n'),
      inline: false
    });
  }

  return fields;
}

function buildDescription(generated = false) {
  return (
    (generated
      ? `${safeEmoji(E.correct, '✅')} Carabao Cup draw generated successfully.\n\n`
      : `${safeEmoji(E.info || E.Carabao, '📌')} Current Carabao Cup fixtures.\n\n`
    ) +
    `🏆 **Top 4 Seeds:** Direct Quarter Finals\n` +
    `🎮 **Seeds 5-18:** Round 1\n` +
    `⚔️ **QFQ:** 3 matches + 1 bye\n` +
    `🔥 **Quarter Finals & Semi Finals:** 2 Legs\n` +
    `👑 **Final:** Single Match`
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('carabaodraw')
    .setDescription('Generate or view Carabao Cup draw')
    .addSubcommand(sub =>
      sub
        .setName('generate')
        .setDescription('Generate Carabao Cup draw')
    )
    .addSubcommand(sub =>
      sub
        .setName('view')
        .setDescription('View current Carabao Cup draw')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'view') {
      const sheet = await cachedGetData('Carabao_Coop_Fixtures!A:L').catch(() => []);

      if (!sheet?.length || sheet.length <= 1) {
        return {
          embeds: [
            new EmbedBuilder()
              .setTitle('🏆 Carabao Cup Draw')
              .setDescription('No Carabao Cup draw generated yet.')
              .setColor(0x5865F2)
          ]
        };
      }

      const rows = sheet.slice(1);

      const fixtures = rows.map(row => ({
        round: clean(row[0]),
        md: clean(row[1]),
        homeShort: clean(row[9]),
        awayShort: clean(row[10])
      }));

      return {
        embeds: [
          new EmbedBuilder()
            .setTitle(`${safeEmoji(E.Carabao, '🏆')} Carabao Cup Draw`)
            .setDescription(buildDescription(false))
            .addFields(formatDrawLines(fixtures))
            .setColor(0x5865F2)
        ]
      };
    }

    if (!isOwner(interaction)) {
      return {
        content: `${safeEmoji(E.lock, '🔒')} Owner only command.`
      };
    }

    const teamsSheet = await cachedGetData('Teams!A:Z');

    if (!teamsSheet?.length || teamsSheet.length <= 1) {
      return {
        content: `${safeEmoji(E.wrong, '❌')} Teams sheet is empty.`
      };
    }

    const header = teamsSheet[0];
    const headerMap = getTeamsHeaderMap(header);

    const teamRows = teamsSheet
      .slice(1)
      .filter(row => clean(row[headerMap.teamName]));

    const activeTeams = getActiveTeamsByCompetition(
      teamRows,
      headerMap,
      'carabao'
    );

    if (activeTeams.length < 2) {
      return {
        content: `${safeEmoji(E.wrong, '❌')} Not enough active Carabao teams.`
      };
    }

    const sortedTeams = sortTeamsByColumn(
      activeTeams,
      headerMap.carabaoSeed,
      headerMap.teamName
    );

    const seedRows = sortedTeams.map(row => ({
      teamName: clean(row[headerMap.teamName]),
      shortName: clean(row[headerMap.shortName]),
      seed: toNumber(row[headerMap.carabaoSeed])
    }));

    const draw = buildCarabaoDraw(seedRows);

    const rowsToSave = draw.fixtures.map(fixture => [
      fixture.round,
      fixture.md,
      fixture.date,
      fixture.homeTeam,
      fixture.awayTeam,
      fixture.hg,
      fixture.ag,
      fixture.result,
      fixture.decision,
      fixture.homeShort,
      fixture.awayShort,
      fixture.status
    ]);

    await updateData('Carabao_Coop_Fixtures!A2:L', rowsToSave);

    invalidateSheetCache([
      'Carabao_Coop_Fixtures!'
    ]);

    sendAuditLog(interaction, {
      title: '🏆 Carabao Cup Draw Generated',
      description: 'Carabao Cup full draw generated successfully.',
      color: 0x2ECC71,
      fields: [
        {
          name: 'Active Teams',
          value: String(activeTeams.length),
          inline: true
        },
        {
          name: 'Fixtures',
          value: String(draw.fixtures.length),
          inline: true
        },
        {
          name: 'QFQ Bye',
          value: draw.qfqBye
            ? `\`${draw.qfqBye.shortName}\` ${draw.qfqBye.teamName}`
            : 'None',
          inline: true
        }
      ]
    });

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle(`${safeEmoji(E.correct, '✅')} Carabao Cup Draw Generated`)
          .setDescription(buildDescription(true))
          .addFields(
            {
              name: 'Active Teams',
              value: String(activeTeams.length),
              inline: true
            },
            {
              name: 'Fixtures',
              value: String(draw.fixtures.length),
              inline: true
            },
            {
              name: 'QFQ Bye',
              value: draw.qfqBye
                ? `\`${draw.qfqBye.shortName}\` ${draw.qfqBye.teamName}`
                : 'None',
              inline: true
            },
            ...formatDrawLines(draw.fixtures)
          )
          .setColor(0x2ECC71)
          .setFooter({
            text: 'Carabao Cup • Top 4 direct QF'
          })
      ]
    };
  }
};
