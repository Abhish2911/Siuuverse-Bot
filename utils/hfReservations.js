const { EmbedBuilder } = require('discord.js');
const E = require('./emojis');
const {
  findTeamByName,
  findTeamMeta,
  sameTeam,
  updateHFFixtureStatus
} = require('./handfootball');

const MAX_RESERVED_MATCHES_PER_TEAM = 3;

function clean(value) {
  return String(value || '').trim();
}

function normalizeMatchNo(value) {
  return clean(value).replace(/^#/, '').toLowerCase();
}

function isReserved(fixture) {
  return normalizeMatchNo(fixture?.status) === 'reserved';
}

function getReservedFixtures(fixtures = [], teamName = '') {
  return fixtures.filter(fixture => (
    isReserved(fixture) && (
      !teamName || sameTeam(fixture.home, teamName) || sameTeam(fixture.away, teamName)
    )
  ));
}

function getTeamReservedCount(fixtures, teamName) {
  return getReservedFixtures(fixtures, teamName).length;
}

function findFixture(fixtures, matchNo) {
  const target = normalizeMatchNo(matchNo);
  return fixtures.find(fixture => normalizeMatchNo(fixture.matchNo) === target) || null;
}

function formatVenue(data, fixture) {
  const homeTeam = findTeamMeta(data.teams, fixture.home);
  const venue = homeTeam.stadiumChannelId || fixture.venue || homeTeam.stadium;
  if (!venue) return 'Venue not set';
  if (/^<#\d{5,25}>$/.test(String(venue))) return String(venue);
  if (/^\d{5,25}$/.test(String(venue))) return `<#${venue}>`;
  return String(venue);
}

function buildReservationEmbed(data, fixtures, teamName = '') {
  const reserved = getReservedFixtures(fixtures, teamName);
  const title = teamName ? `Reserved Matches — ${teamName}` : 'Reserved HandFootball Matches';
  const embed = new EmbedBuilder()
    .setTitle(`${E.calendar} ${title}`)
    .setColor(0xF1C40F)
    .setDescription(
      `${E.lock} **${reserved.length}** reserved match${reserved.length === 1 ? '' : 'es'}${teamName ? ` for **${teamName}**` : ''}.`
    )
    .setTimestamp();

  if (!reserved.length) {
    embed.addFields({ name: 'No Reserved Matches', value: 'There are no reserved matches to show.' });
    return embed;
  }

  for (const fixture of reserved.slice(0, 25)) {
    embed.addFields({
      name: `${E.rank} #${fixture.matchNo} • ${fixture.matchday || 'Matchday not set'}`,
      value: [
        `${E.team} **${fixture.home}** ${E.vs} **${fixture.away}**`,
        `${E.Badge || E.team} ${formatVenue(data, fixture)}`
      ].join('\n'),
      inline: false
    });
  }

  if (reserved.length > 25) {
    embed.setFooter({ text: `Showing 25 of ${reserved.length} reserved matches` });
  }

  return embed;
}

async function reserveFixture(data, matchNo, targetTeam = '') {
  const fixture = findFixture(data.fixtures, matchNo);
  if (!fixture) return { ok: false, reason: `Match **#${matchNo}** was not found.` };
  if (fixture.played) return { ok: false, reason: `Match **#${fixture.matchNo}** already has a result.` };
  if (isReserved(fixture)) return { ok: false, reason: `Match **#${fixture.matchNo}** is already reserved.` };

  const team = targetTeam ? findTeamByName(data, targetTeam) : null;
  const resolvedTeam = team?.team || targetTeam;
  if (resolvedTeam && !sameTeam(fixture.home, resolvedTeam) && !sameTeam(fixture.away, resolvedTeam)) {
    return { ok: false, reason: `**${resolvedTeam}** is not one of the teams in match **#${fixture.matchNo}**.` };
  }

  const involvedTeams = [fixture.home, fixture.away].filter(Boolean);
  const fullTeam = involvedTeams.find(teamName => (
    getTeamReservedCount(data.fixtures, teamName) >= MAX_RESERVED_MATCHES_PER_TEAM
  ));
  if (fullTeam) {
    return { ok: false, reason: `**${fullTeam}** already has ${MAX_RESERVED_MATCHES_PER_TEAM} reserved matches.` };
  }

  const updated = await updateHFFixtureStatus(fixture.matchNo, 'Reserved');
  if (!updated) return { ok: false, reason: `Could not update match **#${fixture.matchNo}** in the Fixtures sheet.` };
  return { ok: true, fixture, reservedTeam: resolvedTeam };
}

module.exports = {
  MAX_RESERVED_MATCHES_PER_TEAM,
  clean,
  normalizeMatchNo,
  isReserved,
  getReservedFixtures,
  getTeamReservedCount,
  findFixture,
  buildReservationEmbed,
  reserveFixture
};
