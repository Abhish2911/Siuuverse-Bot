const {
  canUseHFCaptainCommands,
  findPlayerByUserId,
  isBotOwner,
  loadHandFootballData,
  upsertHFTeamMeta
} = require('../utils/handfootball');
const E = require('../utils/emojis');

function parseTarget(message, args, captainPlayer, owner) {
  const body = args.join(' ').trim();
  const separatorIndex = body.indexOf('|');

  if (owner && separatorIndex !== -1) {
    return {
      team: body.slice(0, separatorIndex).trim(),
      stadium: body.slice(separatorIndex + 1).trim()
    };
  }

  return {
    team: captainPlayer?.team || '',
    stadium: body
  };
}

module.exports = {
  name: 'stadium',
  aliases: ['hfstadium'],

  async execute(message, args) {
    if (!canUseHFCaptainCommands(message)) {
      return message.reply(`${E.wrong} Only HandFootball captains can update team stadiums.`);
    }

    const owner = isBotOwner(message);
    const data = await loadHandFootballData();
    const captainPlayer = findPlayerByUserId(data.players, message.author.id);

    if (!owner && !captainPlayer?.isCaptain) {
      return message.reply(`${E.wrong} Only registered HandFootball team captains can update their stadium.`);
    }

    const { team, stadium } = parseTarget(message, args, captainPlayer, owner);

    if (!team || !stadium) {
      return message.reply(`${E.team} Usage: \`.stadium Stadium Name\` or owner: \`.stadium Team Name | Stadium Name\``);
    }

    await upsertHFTeamMeta(team, { stadium });
    return message.reply(`${E.correct} Updated stadium for **${team}** to **${stadium}**.`);
  }
};
