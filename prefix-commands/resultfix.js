const E = require('../utils/emojis');
const {
  hasHFResultRole,
  loadHandFootballData,
  updateHFFixtureResult
} = require('../utils/handfootball');
const { findFixture } = require('../utils/hfReservations');
const { parseScore, refreshHFStandings, buildResultMessage } = require('../utils/hfResultHelpers');
const { recordMongoResult } = require('../utils/hfMongoResults');

function parseDecisionArgs(args, startIndex) {
  const decisionValue = String(args[startIndex + 1] || '').toLowerCase();
  const penaltyScore = parseScore(args[startIndex + 2] || '');
  return {
    decision: ['home', 'away', 'h', 'a'].includes(decisionValue)
      ? (decisionValue === 'h' ? 'home' : decisionValue === 'a' ? 'away' : decisionValue)
      : '',
    homePenaltyScore: penaltyScore?.homeGoals ?? null,
    awayPenaltyScore: penaltyScore?.awayGoals ?? null
  };
}

function getReferenceMatchNo(message) {
  const content = String(message.content || '');
  return content.match(/\*?\*?Match\*?\*?\s*:\s*#?([\w-]+)/i)?.[1] || '';
}

async function getTargetMatchNo(message, args) {
  const explicitMatchNo = String(args[0] || '').replace(/^#/, '').trim();
  if (args.length > 1 && explicitMatchNo && !parseScore(explicitMatchNo)) return explicitMatchNo;

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
    const scoreStart = parseScore(args[0]) ? 0 : 1;
    const score = parseScore(args[scoreStart] || '');
    const { decision, homePenaltyScore, awayPenaltyScore } = parseDecisionArgs(args, scoreStart);

    if (!matchNo || !score) {
      return message.reply(`${E.profile} Use \`.resultfix #3 4-1 [home|away] [penalty-score]\`.`);
    }

    const data = await loadHandFootballData();
    const fixture = findFixture(data.fixtures, matchNo);
    if (!fixture) return message.reply(`${E.missing} Match **#${matchNo}** was not found.`);
    if (!fixture.played) return message.reply(`${E.warning} Match **#${fixture.matchNo}** does not have a submitted result yet. Use \`.result\`.`);

    const oldScore = `${fixture.homeGoals}-${fixture.awayGoals}`;
    let mongoUpdated;
    try {
      mongoUpdated = await recordMongoResult(
        message.guild.id,
        fixture.matchNo,
        score.homeGoals,
        score.awayGoals,
        { decision, homePenaltyScore, awayPenaltyScore }
      );
    } catch (error) {
      return message.reply(`${E.warning} ${error.message}`);
    }
    if (!mongoUpdated) {
      const updated = await updateHFFixtureResult(fixture.matchNo, score.homeGoals, score.awayGoals);
      if (!updated) return message.reply(`${E.wrong} Could not correct match **#${fixture.matchNo}**.`);
    }

    const standingsStatus = await refreshHFStandings(message.client, message.guild.id);
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
