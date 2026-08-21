const E = require('../utils/emojis');
const {
  hasHFResultRole,
  loadHandFootballData,
  findTeamMeta,
} = require('../utils/handfootball');

const HF_RESULT_ROLE_ID = String(process.env.HF_RESULT_ROLE_ID || '').replace(/[<@&>]/g, '').trim();
const HF_FIXTURES_ROLE_ID = String(process.env.HF_FIXTURES_ROLE_ID || '').replace(/[<@&>]/g, '').trim();

function parseMatchday(args = []) {
  const input = args.map(value => String(value || '').trim()).filter(Boolean);
  if (!input.length) return null;

  const value = input[0].toLowerCase() === 'md' || input[0].toLowerCase() === 'matchday'
    ? input[1]
    : input[0];
  const match = String(value || '').match(/\d+/);

  return match ? Number(match[0]) : null;
}

function getMatchdayNumber(value) {
  const match = String(value || '').match(/\d+/);
  return match ? Number(match[0]) : null;
}

function formatTeam(team, roleIds) {
  if (team?.roleId) {
    roleIds.add(team.roleId);
    return `<@&${team.roleId}>`;
  }

  return `**${team?.team || 'Unknown Team'}**`;
}

function formatStadium(value) {
  const stadium = String(value || '').trim();
  if (!stadium) return '**Venue not set**';
  if (/^<#\d{5,25}>$/.test(stadium)) return stadium;
  if (/^\d{5,25}$/.test(stadium)) return `<#${stadium}>`;
  return `**${stadium}**`;
}

function formatFixture(fixture, data, roleIds) {
  const homeTeam = findTeamMeta(data.teams, fixture.home);
  const awayTeam = findTeamMeta(data.teams, fixture.away);
  const venue = homeTeam.stadiumChannelId || fixture.venue || homeTeam.stadium || 'Venue not set';

  return [
    `${E.rank || '#'} **#${fixture.matchNo}** ${E.duel || E.vs || '⚔️'} ${formatTeam(homeTeam, roleIds)} ${E.vs || '**VS**'} ${formatTeam(awayTeam, roleIds)}`,
    `${E.Badge || E.team || '🏟️'} ${formatStadium(venue)}`,
    fixture.note ? `${E.profile || '📝'} ${fixture.note}` : null
  ].filter(Boolean).join('\n');
}

async function sendFixturePost(message, content, roleIds) {
  const lines = content.split('\n');
  const chunks = [];
  let current = '';

  for (const line of lines) {
    if ((current + (current ? '\n' : '') + line).length > 1900 && current) {
      chunks.push(current);
      current = line;
    } else {
      current += `${current ? '\n' : ''}${line}`;
    }
  }

  if (current) chunks.push(current);

  for (const [index, chunk] of chunks.entries()) {
    const payload = {
      content: chunk,
      allowedMentions: { roles: [...roleIds] }
    };

    if (index === 0) {
      await message.reply(payload);
    } else {
      await message.channel.send(payload);
    }
  }
}

module.exports = {
  name: 'post',
  aliases: ['postfixtures', 'hffixturepost'],

  async execute(message, args) {
    if (!hasHFResultRole(message)) {
      return message.reply(`${E.wrong} Only members with the configured HF result role can post HandFootball fixtures.`);
    }

    if (!HF_RESULT_ROLE_ID) {
      return message.reply(`${E.missing} Add \`HF_RESULT_ROLE_ID\` to your .env first.`);
    }

    const matchdayNumber = parseMatchday(args);
    if (!matchdayNumber) {
      return message.reply(`${E.profile} Usage: \`.post 1\`, \`.post md 1\`, or \`.post matchday 1\`.`);
    }

    const data = await loadHandFootballData();
    const fixtures = data.fixtures.filter(fixture => getMatchdayNumber(fixture.matchday) === matchdayNumber);

    if (!fixtures.length) {
      return message.reply(`${E.missing} No HandFootball fixtures found for Matchday ${matchdayNumber}.`);
    }

    const roleIds = new Set([HF_RESULT_ROLE_ID]);
    if (HF_FIXTURES_ROLE_ID) roleIds.add(HF_FIXTURES_ROLE_ID);
    const fixtureText = fixtures.map(fixture => formatFixture(fixture, data, roleIds)).join('\n\n');
    const content = [
      `${E.team || '⚽'}${E.trophy || '🏆'} **SCHEDULE FOR SIUUVERSE HAND-FOOTBALL LEAGUE** ${E.trophy || '🏆'}${E.team || '⚽'}`,
      `${E.fire || '🔥'} **MATCHDAY ${matchdayNumber}** ${E.fire || '🔥'}`,
      '---',
      fixtureText,
      '---',
      `${E.missing || '📢'} **Any Doubts Ping:** <@&${HF_RESULT_ROLE_ID}>`,
      HF_FIXTURES_ROLE_ID ? `||<@&${HF_FIXTURES_ROLE_ID}>||` : null
    ].filter(Boolean).join('\n\n');

    await sendFixturePost(message, content, roleIds);
  }
};
