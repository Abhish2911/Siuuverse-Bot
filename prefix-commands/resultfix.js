const E = require('../utils/emojis');
const {
  hasHFResultRole,
  loadHandFootballData,
  updateHFFixtureResult
} = require('../utils/handfootball');
const { findFixture } = require('../utils/hfReservations');
const { parseScore, refreshHFStandings, buildResultMessage } = require('../utils/hfResultHelpers');

function getReferenceMatchNo(message) {
  const content = String(message.content || '');
  return content.match(/\*?\*?Match\*?\*?\s*:\s*#?([\w-]+)/i)?.[1] || '';
}

async function getTargetMatchNo(message, args) {
  const explicitMatchNo = String(args[0] || '').replace(/^#/, '').trim();
  if (args.length > 1 && explicitMatchNo) return explicitMatchNo;

  if (!message.reference?.messageId) return explicitMatchNo;
  const referenced = await message.fetchReference().catch(() => null);
  return getReferenceMatchNo(referenced);
}

module.exports = {
  name: 'resultfix',
  aliases: ['fixresult', 'editresult'],

  async execute(message, args) {
    if (!hasHFResultRole(message)) {
      return message.reply(`${E.wrong} Only members with the configured HF result role can correct results.`);
    }

    const matchNo = await getTargetMatchNo(message, args);
    const scoreStart = args.length > 1 ? 1 : 0;
    const score = parseScore(args.slice(scoreStart).join(''));

    if (!matchNo || !score) {
      return message.reply(`${E.profile} Reply to a submitted result with \`.resultfix 4-1\`, or use \`.resultfix #3 4-1\`.`);
    }

    const data = await loadHandFootballData();
    const fixture = findFixture(data.fixtures, matchNo);
    if (!fixture) return message.reply(`${E.missing} Match **#${matchNo}** was not found.`);
    if (!fixture.played) return message.reply(`${E.warning} Match **#${fixture.matchNo}** does not have a submitted result yet. Use \`.result\`.`);

    const oldScore = `${fixture.homeGoals}-${fixture.awayGoals}`;
    const updated = await updateHFFixtureResult(fixture.matchNo, score.homeGoals, score.awayGoals);
    if (!updated) return message.reply(`${E.wrong} Could not correct match **#${fixture.matchNo}** in the Fixtures sheet.`);

    const standingsStatus = await refreshHFStandings(message.client);
    const resultMessage = buildResultMessage({
      corrected: true,
      fixture,
      homeGoals: score.homeGoals,
      awayGoals: score.awayGoals,
      oldScore
    });

    return message.reply(`${resultMessage}\n${E.league} **Live standings:** ${standingsStatus}`);
  }
};
