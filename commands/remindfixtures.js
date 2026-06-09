const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { cachedGetData, getAllowedMatchday, sendAuditLog } = require('../utils/helpers');
const E = require('../utils/emojis');

function isAdmin(interaction) {
  const ownerIds = String(process.env.OWNER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  const adminRoleIds = String(process.env.ADMIN_ROLE_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  const isOwner =
    ownerIds.includes(interaction.user.id) ||
    interaction.guild?.ownerId === interaction.user.id;

  const hasAdminRole = interaction.member?.roles?.cache?.some(role =>
    adminRoleIds.includes(role.id)
  );

  return isOwner || hasAdminRole;
}

function hasScore(row) {
  return row[4] !== '' && row[4] !== undefined && row[5] !== '' && row[5] !== undefined;
}

function getMatchday(row) {
  return String(row[0] || '').split('.')[0].trim();
}

function shortTeam(row, home = true) {
  if (home) return String(row[7] || row[2] || 'HOME').trim();
  return String(row[8] || row[3] || 'AWAY').trim();
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function extractDiscordId(value) {
  const text = String(value || '').trim();
  const mentionMatch = text.match(/<@!?(\d{15,25})>/);
  if (mentionMatch) return mentionMatch[1];

  const rawIdMatch = text.match(/\b\d{15,25}\b/);
  return rawIdMatch ? rawIdMatch[0] : null;
}

function getCaptainMention(teamRow) {
  const captainId = extractDiscordId(teamRow?.[4]);
  return captainId ? `<@${captainId}>` : null;
}

function findCoopTeamRow(teamRows, shortName, fullName) {
  return teamRows.find(team =>
    normalize(team[2]) === normalize(shortName) ||
    normalize(team[0]) === normalize(fullName)
  );
}

function buildReminderSummary(activeMD, remaining, silent, mentions) {
  const firstFixture = remaining[0];
  const secondFixture = remaining[1];
  const thirdFixture = remaining[2];

  const formatFixture = row => {
    if (!row) return 'N/A';
    const home = shortTeam(row, true);
    const away = shortTeam(row, false);
    return `\`${home}\` ${safeEmoji(E.vs, '⚔️')} \`${away}\``;
  };

  return {
    matchday: activeMD,
    remaining: remaining.length,
    silent: silent ? 'Yes' : 'No',
    taggedCaptains: silent ? 0 : mentions.size,
    firstFixture: formatFixture(firstFixture),
    secondFixture: formatFixture(secondFixture),
    thirdFixture: formatFixture(thirdFixture)
  };
}

function buildReminderDescription(summary) {
  return (
    `${safeEmoji(E.calendar, '📢')} **Matchday Reminder Overview**\n` +
    `Remaining fixtures for the current active matchday, ready to post in the current channel.\n\n` +
    `${safeEmoji(E.calendar, '📅')} **Matchday:** ${summary.matchday}\n` +
    `${safeEmoji(E.missing, '⏳')} **Remaining Matches:** ${summary.remaining}\n` +
    `${safeEmoji(E.captain, '👑')} **Tagged Captains:** ${summary.taggedCaptains}\n` +
    `🔕 **Silent Mode:** ${summary.silent}\n\n` +
    `${safeEmoji(E.fire, '🔥')} **1st Fixture:** ${summary.firstFixture}\n` +
    `${safeEmoji(E.runnerUp || E.medal, '🥈')} **2nd Fixture:** ${summary.secondFixture}\n` +
    `${safeEmoji(E.medal, '🥉')} **3rd Fixture:** ${summary.thirdFixture}`
  );
}

function getCompetitionConfigs() {
  return [
    {
      key: 'League',
      fixturesRange: 'Fixtures!A:I',
      activeMatchday: true,
      matchdayColumn: 0,
      homeCol: 2,
      awayCol: 3,
      homeShortCol: 7,
      awayShortCol: 8,
      scoreHomeCol: 4,
      scoreAwayCol: 5
    },
    {
      key: 'UCL',
      fixturesRange: 'UCL_Coop_Group_Fixtures!A:J',
      activeMatchday: false,
      matchdayColumn: 0,
      homeCol: 2,
      awayCol: 3,
      homeShortCol: 7,
      awayShortCol: 8,
      scoreHomeCol: 4,
      scoreAwayCol: 5
    },
    {
      key: 'FA Cup',
      fixturesRange: 'FA_Cup_Coop_Fixtures!A:K',
      activeMatchday: false,
      matchdayColumn: 1,
      homeCol: 3,
      awayCol: 4,
      homeShortCol: 8,
      awayShortCol: 9,
      scoreHomeCol: 5,
      scoreAwayCol: 6
    },
    {
      key: 'Carabao Cup',
      fixturesRange: 'Carabao_Coop_Fixtures!A:K',
      activeMatchday: false,
      matchdayColumn: 1,
      homeCol: 3,
      awayCol: 4,
      homeShortCol: 8,
      awayShortCol: 9,
      scoreHomeCol: 5,
      scoreAwayCol: 6
    }
  ];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remindfixtures')
    .setDescription('Post remaining fixtures of the current active matchday and tag captains')
    .addBooleanOption(opt =>
      opt
        .setName('silent')
        .setDescription('Send without captain/player mentions')
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return { content: `${safeEmoji(E.lock, '🚫')} Admin only command.` };
    }

    const silent = interaction.options.getBoolean('silent') || false;

    const configs = getCompetitionConfigs();

    const data = await Promise.all([
      cachedGetData('Teams!A:Z'),
      ...configs.map(c => cachedGetData(c.fixturesRange).catch(() => []))
    ]);

    const teams = data[0];
    const teamRows = Array.isArray(teams) ? teams.slice(1) : [];

    const remaining = [];

    for (let i = 0; i < configs.length; i++) {
      const config = configs[i];
      const fixtures = data[i + 1];

      if (!Array.isArray(fixtures) || fixtures.length <= 1) continue;

      let rows = fixtures.slice(1);

      if (config.activeMatchday) {
        const active = getAllowedMatchday(fixtures);
        if (!active) continue;

        const activeMD = String(active).split('.')[0].trim();
        rows = rows.filter(r => String(r[0] || '').split('.')[0].trim() === activeMD);
      }

      for (const row of rows) {
        const hg = row[config.scoreHomeCol];
        const ag = row[config.scoreAwayCol];

        if (hg !== '' && hg !== undefined && ag !== '' && ag !== undefined) {
          continue;
        }

        remaining.push({ row, config });
      }
    }

    if (!remaining.length) {
      return {
        embeds: [
          new EmbedBuilder()
            .setTitle(`${safeEmoji(E.correct, '✅')} No Pending Fixtures`)
            .setDescription('League, UCL, FA Cup and Carabao Cup fixtures are all completed.')
            .setColor(0x2ECC71)
        ]
      };
    }

    const fixtureLines = [];
    const mentions = new Set();

    for (const item of remaining) {
      const row = item.row;
      const config = item.config;

      const matchNo = String(row[config.matchdayColumn] || '-').trim();
      const homeShort = String(row[config.homeShortCol] || row[config.homeCol] || 'HOME').trim();
      const awayShort = String(row[config.awayShortCol] || row[config.awayCol] || 'AWAY').trim();

      const homeMention = getCaptainMention(findCoopTeamRow(teamRows, homeShort, row[config.homeCol]));
      const awayMention = getCaptainMention(findCoopTeamRow(teamRows, awayShort, row[config.awayCol]));

      if (!silent) {
        if (homeMention) mentions.add(homeMention);
        if (awayMention) mentions.add(awayMention);
      }

      fixtureLines.push(
        `**${config.key} • ${matchNo}** • \`${homeShort}\` ${safeEmoji(E.vs, '⚔️')} \`${awayShort}\`` +
        (!silent && (homeMention || awayMention)
          ? `\n> ${safeEmoji(E.captain, '👑')} ${[homeMention, awayMention].filter(Boolean).join(' ')}`
          : '')
      );
    }

    const summary = buildReminderSummary('All Competitions', remaining.map(x => x.row), silent, mentions);

    const mentionText = silent || !mentions.size
      ? ''
      : `${[...mentions].join(' ')}\n\n`;

    const embed = new EmbedBuilder()
      .setTitle(`League • UCL • FA Cup • Carabao Cup Reminder`)
      .setDescription(buildReminderDescription(summary))
      .addFields(
        {
          name: `${safeEmoji(E.missing, '⏳')} Remaining Matches`,
          value: (fixtureLines.join('\n\n') || 'None').slice(0, 1024),
          inline: false
        }
      )
      .setColor(0xF1C40F)
      .setFooter({ text: silent ? 'Remind Fixtures • Silent reminder sent' : 'Remind Fixtures • Captains tagged automatically' });

    await interaction.channel.send({
      content: `${mentionText}⚽ **Pending fixtures reminder across all competitions**\n\n${fixtureLines.join('\n\n').slice(0, 1800)}`,
      embeds: [embed]
    });

    sendAuditLog(interaction, {
      title: '📢 Fixtures Reminder Sent',
      description: `Remaining fixture reminder posted for League, UCL, FA Cup and Carabao Cup.`,
      color: 0xF1C40F,
      fields: [
        { name: '⏳ Remaining Matches', value: String(remaining.length), inline: true },
        { name: '🔕 Silent', value: silent ? 'Yes' : 'No', inline: true }
      ]
    });

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle(`${safeEmoji(E.correct, '✅')} Reminder Posted`)
          .setDescription(
            `Reminder posted in this channel for all pending League, UCL, FA Cup and Carabao Cup fixtures.\n\n` +
            `${safeEmoji(E.missing, '⏳')} Remaining Matches: **${remaining.length}**\n` +
            `🔕 Silent: **${silent ? 'Yes' : 'No'}**`
          )
          .addFields(
            { name: '⏳ Remaining Matches', value: String(remaining.length), inline: true },
            { name: '🔕 Silent', value: silent ? 'Yes' : 'No', inline: true },
            { name: '👑 Tagged Captains', value: String(silent ? 0 : mentions.size), inline: true }
          )
          .setColor(0x2ECC71)
          .setFooter({ text: 'Remind Fixtures • Reminder posted successfully' })
      ]
    };
  }
};
