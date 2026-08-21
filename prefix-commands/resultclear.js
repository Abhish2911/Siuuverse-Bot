const E = require('../utils/emojis');
const {
  hasHFResultRole,
  loadHandFootballData,
  clearHFFixtureResult
} = require('../utils/handfootball');
const { findFixture } = require('../utils/hfReservations');
const { refreshHFStandings } = require('../utils/hfResultHelpers');

module.exports = {
  name: 'resultclear',
  aliases: ['clearresult', 'removeresult'],

  async execute(message, args) {
    if (!hasHFResultRole(message)) {
      return message.reply(`${E.wrong} Only members with the configured HF result role can clear results.`);
    }

    const matchNo = String(args[0] || '').replace(/^#/, '').trim();
    if (!matchNo) {
      return message.reply(`${E.profile} Usage: \`.resultclear #3\`.`);
    }

    const data = await loadHandFootballData();
    const fixture = findFixture(data.fixtures, matchNo);
    if (!fixture) return message.reply(`${E.missing} Match **#${matchNo}** was not found.`);
    if (!fixture.played) return message.reply(`${E.warning} Match **#${fixture.matchNo}** has no result to clear.`);

    const cleared = await clearHFFixtureResult(fixture.matchNo);
    if (!cleared) return message.reply(`${E.wrong} Could not clear match **#${fixture.matchNo}** in the Fixtures sheet.`);

    const standingsStatus = await refreshHFStandings(message.client);
    return message.reply([
      `${E.correct} Result cleared for match **#${fixture.matchNo}**.`,
      `**Fixture:** ${fixture.home} ${E.vs} ${fixture.away}`,
      `${E.league} **Live standings:** ${standingsStatus}`
    ].join('\n'));
  }
};
