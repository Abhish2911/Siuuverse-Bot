const E = require('../utils/emojis');
const {
  hasHFResultRole,
  loadHandFootballData,
  updateHFFixtureResult
} = require('../utils/handfootball');
const { findFixture } = require('../utils/hfReservations');
const { parseScore, refreshHFStandings, buildResultMessage } = require('../utils/hfResultHelpers');
const { getActiveTournament, sendTournamentLog } = require('../utils/hfTournamentLogging');
const { recordMongoResult } = require('../utils/hfMongoResults');

function parseResultArgs(args = []) {
  const matchNo = String(args[0] || '').replace(/^#/, '').trim();
  const score = parseScore(args[1] || '');
  const decision = String(args[2] || '').toLowerCase();
  const penaltyScore = parseScore(args[3] || '');
  return {
    matchNo,
    score,
    decision: ['home', 'away', 'h', 'a'].includes(decision)
      ? (decision === 'h' ? 'home' : decision === 'a' ? 'away' : decision)
      : '',
    homePenaltyScore: penaltyScore?.homeGoals ?? null,
    awayPenaltyScore: penaltyScore?.awayGoals ?? null
  };
}

module.exports = {
  name: 'result',
  aliases: ['hfresult', 'submitresult'],

  async execute(message, args) {
    if (!hasHFResultRole(message)) {
      return message.reply(`${E.wrong} Only members with the configured HF result role can submit results.`);
    }

    const { matchNo, score, decision, homePenaltyScore, awayPenaltyScore } = parseResultArgs(args);
    if (!matchNo || !score) {
      return message.reply(`${E.profile} Usage: \.result #3 3-2 [home|away] [penalty-score]`);
    }

    const data = await loadHandFootballData();
    const fixture = findFixture(data.fixtures, matchNo);
    if (!fixture) return message.reply(`${E.missing} Match **#${matchNo}** was not found.`);
    if (fixture.played) {
      return message.reply(`${E.warning} Match **#${fixture.matchNo}** already has a result. Reply to its submitted message with \`.resultfix H-A\`.`);
    }

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
      if (!updated) return message.reply(`${E.wrong} Could not update match **#${fixture.matchNo}**.`);
    }

    const standingsStatus = await refreshHFStandings(message.client, message.guild.id);
    const resultMessage = buildResultMessage({
      fixture,
      homeGoals: score.homeGoals,
      awayGoals: score.awayGoals
    });

    const tournament = await getActiveTournament(message.guild.id);
    await sendTournamentLog(
      message.guild,
      tournament?.resultChannelId,
      `⚽ **Match result logged**\n**${fixture.home}** ${score.homeGoals}-${score.awayGoals} **${fixture.away}**${decision ? `\nWinner: **${decision}**${homePenaltyScore !== null ? ` (${homePenaltyScore}-${awayPenaltyScore} pens)` : ''}` : ''}\nMatch: \`${fixture.matchNo}\`\nLogged by: <@${message.author.id}>`
    );

    return message.reply(`${resultMessage}\n${E.league} **Live standings:** ${standingsStatus}`);
  }
};
