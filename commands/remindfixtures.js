const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { cachedGetData, getAllowedMatchday, sendAuditLog, getAllPlayerIds } = require('../utils/helpers');
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
      key: 'UCL GS',
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
      key: 'UCL KO',
      fixturesRange: 'UCL_Coop_Knockout_Fixtures!A:L',
      activeMatchday: false,
      matchdayColumn: 0,
      homeCol: 2,
      awayCol: 3,
      homeShortCol: 8,
      awayShortCol: 9,
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
    .addStringOption(opt =>
      opt
        .setName('competition')
        .setDescription('Competition to remind')
        .setRequired(true)
        .addChoices(
          { name: 'League', value: 'league' },
          { name: 'UCL', value: 'ucl' },
          { name: 'FA Cup', value: 'fa' },
          { name: 'Carabao Cup', value: 'carabao' },
          { name: 'All Competitions', value: 'all' }
        )
    )
    .addStringOption(opt =>
      opt
        .setName('matchday')
        .setDescription('Specific matchday/round to remind (optional)')
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt
        .setName('silent')
        .setDescription('Send without captain/player mentions')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt
        .setName('notify')
        .setDescription('How players should be notified')
        .setRequired(false)
        .addChoices(
          { name: 'DM Players', value: 'dm' },
          { name: 'Mention Players', value: 'mention' },
          { name: 'No Notifications', value: 'none' }
        )
    ),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return { content: `${safeEmoji(E.lock, '🚫')} Admin only command.` };
    }

    const competition = interaction.options.getString('competition') || 'all';
    const selectedMatchday = String(
      interaction.options.getString('matchday') || ''
    ).trim();
    const silent = interaction.options.getBoolean('silent') || false;
    const notifyMode = interaction.options.getString('notify') || 'dm';

    let configs = getCompetitionConfigs();

    if (competition !== 'all') {
      configs = configs.filter(c => {
        if (competition === 'league') return c.key === 'League';
        if (competition === 'ucl') return c.key === 'UCL GS' || c.key === 'UCL KO';
        if (competition === 'fa') return c.key === 'FA Cup';
        if (competition === 'carabao') return c.key === 'Carabao Cup';
        return true;
      });
    }

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

      if (selectedMatchday) {
        rows = rows.filter(r =>
          String(r[config.matchdayColumn] || '')
            .trim()
            .toUpperCase()
            .includes(selectedMatchday.toUpperCase())
        );
      } else if (config.activeMatchday) {
        const active = getAllowedMatchday(fixtures);

        if (!active) {
          rows = rows.filter(r => {
            const hg = r[config.scoreHomeCol];
            const ag = r[config.scoreAwayCol];
            return hg === '' || hg === undefined || ag === '' || ag === undefined;
          });
        } else {
          const activeMD = String(active).split('.')[0].trim();
          rows = rows.filter(r => String(r[0] || '').split('.')[0].trim() === activeMD);
        }
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
            .setDescription(
              competition === 'all'
                ? 'League, UCL, FA Cup and Carabao Cup fixtures are all completed.'
                : `All ${configs[0].key} fixtures are completed.`
            )
            .setColor(0x2ECC71)
        ]
      };
    }

    const fixtureLines = [];
    const playerIds = new Set();

    const reserveData = await cachedGetData('Reserve!A:F').catch(() => []);
    const reservedMatches = new Set(
      (Array.isArray(reserveData) ? reserveData.slice(1) : [])
        .map(r => String(r[0] || '').trim().toUpperCase())
        .filter(Boolean)
    );

    for (const item of remaining) {
      const row = item.row;
      const config = item.config;

      const matchNo = String(row[config.matchdayColumn] || '-').trim();

      if (reservedMatches.has(matchNo.toUpperCase())) {
        continue;
      }

      const homeShort = String(row[config.homeShortCol] || row[config.homeCol] || 'HOME').trim();
      const awayShort = String(row[config.awayShortCol] || row[config.awayCol] || 'AWAY').trim();

      const homeTeam = findCoopTeamRow(teamRows, homeShort, row[config.homeCol]);
      const awayTeam = findCoopTeamRow(teamRows, awayShort, row[config.awayCol]);

      if (!silent && notifyMode !== 'none') {
        getAllPlayerIds(homeTeam).forEach(id => playerIds.add(id));
        getAllPlayerIds(awayTeam).forEach(id => playerIds.add(id));
      }

      fixtureLines.push(
        `**${config.key} • ${matchNo}** • \`${homeShort}\` ${safeEmoji(E.vs, '⚔️')} \`${awayShort}\``
      );
    }

    const summary = buildReminderSummary('All Competitions', remaining.map(x => x.row), silent, playerIds);

    const embed = new EmbedBuilder()
      .setTitle(
        competition === 'all'
          ? `League • UCL • FA Cup • Carabao Cup ${selectedMatchday ? `• ${selectedMatchday}` : ''} Reminder`
          : `${configs[0].key}${selectedMatchday ? ` • ${selectedMatchday}` : ''} Reminder`
      )
      .setDescription(buildReminderDescription(summary))
      .addFields(
        {
          name: `${safeEmoji(E.missing, '⏳')} Remaining Matches`,
          value: (fixtureLines.join('\n\n') || 'None').slice(0, 1024),
          inline: false
        }
      )
      .setColor(0xF1C40F)
      .setFooter({ text: silent ? 'Remind Fixtures • Silent reminder sent' : 'Remind Fixtures • Players notified via DM' });

    let mentionText = '';

    if (!silent && notifyMode === 'dm') {
      for (const userId of playerIds) {
        try {
          const user = await interaction.client.users.fetch(userId);

          await user.send({
            embeds: [
              new EmbedBuilder()
                .setTitle('⚽ Fixture Reminder')
                .setDescription(
                  `You have pending fixtures in ${
                    competition === 'all'
                      ? 'COOP competitions'
                      : configs[0].key
                  }.\n\nPlease arrange and play your matches as soon as possible.`
                )
                .setColor(0xF1C40F)
            ]
          });
        } catch {}
      }
    }

    if (!silent && notifyMode === 'mention' && playerIds.size) {
      mentionText = [...playerIds].map(id => `<@${id}>`).join(' ');
    }

    await interaction.channel.send({
      content:
        `${mentionText}${mentionText ? '\n\n' : ''}` +
        `⚽ **${
          competition === 'all'
            ? 'All Competitions'
            : configs[0].key
        } Fixtures Reminder**`,
      embeds: [embed]
    });

    sendAuditLog(interaction, {
      title: '📢 Fixtures Reminder Sent',
      description: competition === 'all'
        ? 'Remaining fixture reminder posted for League, UCL, FA Cup and Carabao Cup.'
        : `Remaining fixture reminder posted for ${configs[0].key}.`,
      color: 0xF1C40F,
      fields: [
        { name: '⏳ Remaining Matches', value: String(remaining.length), inline: true },
        { name: '📢 Notify Mode', value: notifyMode, inline: true },
        { name: '🔕 Silent', value: silent ? 'Yes' : 'No', inline: true }
      ]
    });

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle(`${safeEmoji(E.correct, '✅')} Reminder Posted`)
          .setDescription(
            (competition === 'all'
              ? 'Reminder posted in this channel for all pending League, UCL, FA Cup and Carabao Cup fixtures.\n\n'
              : `Reminder posted in this channel for pending ${configs[0].key} fixtures.\n\n`) +
            (selectedMatchday ? `Matchday/Round Filter: **${selectedMatchday}**\n\n` : '') +
            `${safeEmoji(E.missing, '⏳')} Remaining Matches: **${remaining.length}**\n` +
            `🔕 Silent: **${silent ? 'Yes' : 'No'}**\n` +
            `📢 Notify Mode: **${notifyMode}**`
          )
          .addFields(
            { name: '⏳ Remaining Matches', value: String(remaining.length), inline: true },
            { name: '🔕 Silent', value: silent ? 'Yes' : 'No', inline: true },
            { name: '📢 Notify Mode', value: notifyMode, inline: true },
            { name: '📩 Players Notified', value: String(silent ? 0 : playerIds.size), inline: true }
          )
          .setColor(0x2ECC71)
          .setFooter({ text: 'Remind Fixtures • Reminder posted successfully' })
      ]
    };
  }
};
