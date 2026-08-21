const E = require('../utils/emojis');
const {
  hasHFResultRole,
  loadHandFootballData,
  updateHFFixtureResult
} = require('../utils/handfootball');
const { findFixture } = require('../utils/hfReservations');
const { parseScore, refreshHFStandings, buildResultMessage } = require('../utils/hfResultHelpers');

function parseResultArgs(args = []) {
  const matchNo = String(args[0] || '').replace(/^#/, '').trim();
  const score = parseScore(args.slice(1).join(''));
  return { matchNo, score };
}

module.exports = {
  name: 'result',
  aliases: ['hfresult', 'submitresult'],

  async execute(message, args) {
    if (!hasHFResultRole(message)) {
      return message.reply(`${E.wrong} Only members with the configured HF result role can submit results.`);
    }

    const { matchNo, score } = parseResultArgs(args);
    if (!matchNo || !score) {
      return message.reply(`${E.profile} Usage: \`.result #3 3-2\`.`);
    }

    const data = await loadHandFootballData();
    const fixture = findFixture(data.fixtures, matchNo);
    if (!fixture) return message.reply(`${E.missing} Match **#${matchNo}** was not found.`);
    if (fixture.played) {
      return message.reply(`${E.warning} Match **#${fixture.matchNo}** already has a result. Reply to its submitted message with \`.resultfix H-A\`.`);
    }

    const updated = await updateHFFixtureResult(fixture.matchNo, score.homeGoals, score.awayGoals);
    if (!updated) return message.reply(`${E.wrong} Could not update match **#${fixture.matchNo}** in the Fixtures sheet.`);

    const standingsStatus = await refreshHFStandings(message.client);
    const resultMessage = buildResultMessage({
      fixture,
      homeGoals: score.homeGoals,
      awayGoals: score.awayGoals
    });

    return message.reply(`${resultMessage}\n${E.league} **Live standings:** ${standingsStatus}`);
  }
};
