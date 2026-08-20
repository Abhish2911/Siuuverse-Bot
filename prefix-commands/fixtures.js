const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const E = require('../utils/emojis');
const {
  findPlayerByName,
  findPlayerByUserId,
  findTeamByName,
  findTeamMeta,
  getFirstIdArg,
  getMentionedUserId,
  getNextFixture,
  getSearchText,
  getTeamFixtures,
  getTeamRecord,
  getTeamRoster,
  loadHandFootballData,
  mentionUser,
  sameTeam,
  toNumber,
  truncateField
} = require('../utils/handfootball');

const PER_PAGE = 4;

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function parseHexColor(value, fallback = 0x5865F2) {
  const color = String(value || '').trim();
  if (!/^#[0-9a-f]{6}$/i.test(color)) return fallback;
  return Number.parseInt(color.slice(1), 16);
}

function getTeamColor(guild, teamMeta) {
  if (teamMeta.color) {
    return parseHexColor(teamMeta.color, 0x5865F2);
  }

  const role = teamMeta.roleId ? guild?.roles?.cache?.get(teamMeta.roleId) : null;
  return role?.color || 0x5865F2;
}

function splitPageArg(args) {
  const nextArgs = [...args];
  const lastArg = nextArgs[nextArgs.length - 1];
  let page = 0;

  if (/^\d+$/.test(String(lastArg || '').trim())) {
    page = Math.max(0, Number.parseInt(lastArg, 10) - 1);
    nextArgs.pop();
  }

  return { args: nextArgs, page };
}

function resolveTeam(data, message, args) {
  const mentionedUserId = getMentionedUserId(message);
  const idArg = getFirstIdArg(args);
  const searchText = getSearchText(args);

  if (mentionedUserId || idArg) {
    const player = findPlayerByUserId(data.players, mentionedUserId || idArg);
    return player?.team || '';
  }

  if (searchText) {
    const team = findTeamByName(data, searchText);
    if (team) return team.team;

    const player = findPlayerByName(data.players, searchText);
    return player?.team || '';
  }

  return findPlayerByUserId(data.players, message.author.id)?.team || '';
}

function getOpponent(fixture, teamName) {
  return sameTeam(fixture.home, teamName) ? fixture.away : fixture.home;
}

function formatRecord(record) {
  const goalDifference = record.goalsFor - record.goalsAgainst;
  return [
    `${E.win} ${record.wins}W  ${E.draw} ${record.draws}D  ${E.lose} ${record.losses}L`,
    `${E.rank} GD: ${goalDifference >= 0 ? '+' : ''}${goalDifference} | Pts: ${record.points}`
  ].join('\n');
}

function formatFixtureStatus(fixture) {
  if (fixture.played) {
    return `${fixture.homeGoals}-${fixture.awayGoals}`;
  }

  return fixture.status || 'Pending';
}

function getFixtureStatusEmoji(fixture) {
  return fixture.played ? E.played : E.calendar;
}

function formatFixtureLine(fixture, teamName) {
  const prefix = sameTeam(fixture.home, teamName) ? 'Home' : 'Away';
  const matchday = fixture.matchday || `Match ${fixture.matchNo}`;
  const venue = fixture.venue ? `Venue: **${fixture.venue}**` : '';

  return [
    `**${E.rank} #${fixture.matchNo} - ${matchday}**`,
    `${E.team} ${prefix}: **${fixture.home} ${E.vs} ${fixture.away}**`,
    venue ? `${E.team} ${venue}` : '',
    `${getFixtureStatusEmoji(fixture)} Status: **${formatFixtureStatus(fixture)}**`
  ].filter(Boolean).join('\n');
}

function buildButtons(page, totalPages, teamName, ownerId) {
  const encodedTeam = encodeURIComponent(teamName);

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`hffixtures_prev_${page}_team_${encodedTeam}_${ownerId}`)
      .setLabel('Previous')
      .setEmoji(E.leftArrow)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`hffixtures_next_${page}_team_${encodedTeam}_${ownerId}`)
      .setLabel('Next')
      .setEmoji(E.rightArrow)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page >= totalPages - 1)
  );
}

function buildFixturePayload({ data, guild, user, teamName, page, ownerId }) {
  const teamMeta = findTeamMeta(data.teams, teamName);
  const fixtures = getTeamFixtures(data.fixtures, teamName);
  const record = getTeamRecord(data.fixtures, teamName);
  const nextFixture = getNextFixture(data.fixtures, teamName);
  const totalPages = Math.max(1, Math.ceil(fixtures.length / PER_PAGE));
  const safePage = Math.max(0, Math.min(Number(page) || 0, totalPages - 1));
  const start = safePage * PER_PAGE;
  const pageFixtures = fixtures.slice(start, start + PER_PAGE);
  const nextOpponent = nextFixture ? getOpponent(nextFixture, teamName) : '';
  const opponentCaptains = nextOpponent
    ? getTeamRoster(data.players, nextOpponent).filter(player => player.isCaptain)
    : [];
  const fixtureText = pageFixtures.map(fixture => formatFixtureLine(fixture, teamName)).join('\n\n') || `${E.missing} No fixtures found.`;

  const embed = new EmbedBuilder()
    .setTitle(`${safeEmoji(E.calendar, 'Fixtures')} ${teamName} - Fixtures`)
    .setColor(getTeamColor(guild, teamMeta))
    .setDescription(
      [
        `${E.team} Stadium: **${teamMeta.stadium || teamMeta.venue || 'Not set'}**`,
        `${E.rank} Record:\n${formatRecord(record)}`,
        '',
        `${E.calendar} **Fixtures ${fixtures.length ? start + 1 : 0}-${Math.min(start + PER_PAGE, fixtures.length)} of ${fixtures.length}**`,
        fixtureText
      ].join('\n')
    )
    .addFields(
      {
        name: `${E.calendar} Next Match`,
        value: nextFixture
          ? truncateField([
              `**${nextFixture.home} ${E.vs} ${nextFixture.away}**`,
              `${E.rank} ${nextFixture.matchday || `Match ${nextFixture.matchNo}`}`,
              nextFixture.venue ? `${E.team} Venue: **${nextFixture.venue}**` : '',
              `${E.captain} Opponent captain${opponentCaptains.length === 1 ? '' : 's'}: ${opponentCaptains.length ? opponentCaptains.map(captain => mentionUser(captain.userId)).join(', ') : 'Not set'}`,
              `${getFixtureStatusEmoji(nextFixture)} Status: **${formatFixtureStatus(nextFixture)}**`
            ].filter(Boolean).join('\n'))
          : `${E.missing} No pending matches.`,
        inline: false
      }
    )
    .setFooter({
      text: `Page ${safePage + 1}/${totalPages} - Requested by ${user.username}`
    })
    .setTimestamp();

  if (teamMeta.logoUrl) {
    embed.setThumbnail(teamMeta.logoUrl);
  }

  const components = totalPages > 1
    ? [buildButtons(safePage, totalPages, teamName, ownerId || user.id)]
    : [];

  return { embeds: [embed], components };
}

module.exports = {
  name: 'fixtures',
  aliases: ['nm', 'myfixtures', 'hffixtures'],

  async execute(message, args) {
    const parsed = splitPageArg(args);
    const data = await loadHandFootballData();
    const teamName = resolveTeam(data, message, parsed.args);

    if (!teamName) {
      return message.reply(`${E.missing} HandFootball team not found. Use \`.nm\`, \`.nm @user\`, or \`.nm Team Name\`.`);
    }

    if (!data.fixtures.length) {
      return message.reply(`${E.missing} No Fixtures sheet data found yet.`);
    }

    return message.reply(buildFixturePayload({
      data,
      guild: message.guild,
      user: message.author,
      teamName,
      page: parsed.page,
      ownerId: message.author.id
    }));
  },

  async buttonHandler(interaction, action, page, targetType, targetValue, ownerId) {
    const data = await loadHandFootballData();
    const team = targetType === 'team'
      ? findTeamByName(data, targetValue)
      : null;
    const currentPage = Number.parseInt(page, 10);
    const nextPage = action === 'prev'
      ? currentPage - 1
      : currentPage + 1;

    return buildFixturePayload({
      data,
      guild: interaction.guild,
      user: interaction.user,
      teamName: team?.team || targetValue,
      page: nextPage,
      ownerId
    });
  }
};
