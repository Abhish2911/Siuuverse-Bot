const E = require('../utils/emojis');
const {
  hasHFResultRole,
  loadHandFootballData,
  sameTeam
} = require('../utils/handfootball');
const {
  reserveFixture,
  clean
} = require('../utils/hfReservations');

function parseArgs(args = []) {
  const values = args.map(clean).filter(Boolean);
  const matchIndex = values.findIndex(value => /^#?\d+$/.test(value));
  if (matchIndex === -1) return { matchNo: '', teamText: values.join(' ') };

  return {
    matchNo: values[matchIndex].replace(/^#/, ''),
    teamText: values.filter((_, index) => index !== matchIndex).join(' ').trim()
  };
}

module.exports = {
  name: 'reserve',
  aliases: ['reservecmatch'],

  async execute(message, args) {
    const data = await loadHandFootballData();
    const isResultRole = hasHFResultRole(message);
    const captainTeams = data.players
      .filter(item => item.userId === message.author.id && item.isCaptain)
      .map(item => item.team);
    const parsed = parseArgs(args);

    if (!parsed.matchNo) {
      return message.reply(`${E.profile} Usage: \`.reserve #3\` or \`.reserve Team Name #3\`.`);
    }

    if (!isResultRole && !captainTeams.length) {
      return message.reply(`${E.wrong} Only HandFootball captains or the configured HF result role can reserve matches.`);
    }

    if (isResultRole && parsed.teamText) {
      const targetTeam = data.teams.find(team => sameTeam(team.team, parsed.teamText))?.team
        || data.players.find(item => sameTeam(item.team, parsed.teamText))?.team
        || parsed.teamText;
      const result = await reserveFixture(data, parsed.matchNo, targetTeam);
      if (!result.ok) return message.reply(`${E.wrong} ${result.reason}`);

      return message.reply(`${E.correct} Match **#${result.fixture.matchNo}** reserved for **${result.reservedTeam}**.`);
    }

    const fixture = data.fixtures.find(item => String(item.matchNo) === String(parsed.matchNo));
    if (!fixture) return message.reply(`${E.missing} Match **#${parsed.matchNo}** was not found.`);

    const captainTeam = captainTeams.find(team => (
      sameTeam(team, fixture.home) || sameTeam(team, fixture.away)
    ));

    if (!captainTeam) {
      return message.reply(`${E.wrong} You must be captain of one of the teams in match **#${fixture.matchNo}**.`);
    }

    if (parsed.teamText && !captainTeams.some(team => sameTeam(team, parsed.teamText))) {
      return message.reply(`${E.wrong} You can only reserve for your own team.`);
    }

    const result = await reserveFixture(data, parsed.matchNo, captainTeam);
    if (!result.ok) return message.reply(`${E.wrong} ${result.reason}`);

    return message.reply(`${E.correct} Match **#${result.fixture.matchNo}** reserved for **${captainTeam}**.`);
  }
};
