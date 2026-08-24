const {
  findPlayerByName,
  findPlayerByUserId,
  findTeamMeta,
  getFirstIdArg,
  getMentionedUserId,
  isBotOwner,
  loadHandFootballData,
  removeHFPlayer,
  sameTeam
} = require('../utils/handfootball');
const E = require('../utils/emojis');

function getPlayerSearchText(args, userId) {
  return args
    .filter(arg => !/<@!?\d+>/.test(arg))
    .filter(arg => String(arg || '').trim() !== String(userId || '').trim())
    .join(' ')
    .trim();
}

module.exports = {
  name: 'hfremove',
  aliases: ['removehfplayer'],

  async execute(message, args) {
    const data = await loadHandFootballData();
    const owner = isBotOwner(message);
    const mentionedUserId = getMentionedUserId(message);
    const idArg = getFirstIdArg(args);
    const userId = mentionedUserId || idArg;
    const searchText = getPlayerSearchText(args, userId);
    const player = userId
      ? findPlayerByUserId(data.players, userId)
      : findPlayerByName(data.players, searchText);

    if (!player) {
      return message.reply(`${E.missing} HandFootball player not found. Provide a player mention, ID, or name.`);
    }

    const captainTeams = data.players
      .filter(item => item.userId === message.author.id && item.isCaptain)
      .map(item => item.team);
    if (!owner && !captainTeams.some(team => sameTeam(team, player.team))) {
      return message.reply(`${E.wrong} Only the captain of **${player.team}** can remove this player.`);
    }

    if (!owner && player.isCaptain) {
      return message.reply(`${E.warning} The team captain cannot be removed. Transfer captaincy first.`);
    }

    await removeHFPlayer(player.userId);

    // Remove the Discord team role at the same time as the sheet entry so a
    // later sync does not depend on the member already being cached.
    let teamRoleRemoved = false;
    let teamRoleRemovalFailed = false;
    const teamRoleId = findTeamMeta(data.teams, player.team).roleId;
    if (teamRoleId) {
      const member = await message.guild.members.fetch(player.userId).catch(() => null);
      if (member?.roles.cache.has(teamRoleId)) {
        try {
          await member.roles.remove(teamRoleId, 'HandFootball player removed');
          teamRoleRemoved = true;
        } catch (error) {
          teamRoleRemovalFailed = true;
          console.error(`HF team role removal failed for ${player.userId}:`, error);
        }
      }
    }

    return message.reply(
      `${E.correct} Removed **${player.player}** (<@${player.userId}>) from **${player.team}**${teamRoleRemoved ? ' and removed their team role' : teamRoleRemovalFailed ? ', but I could not remove their team role' : ''}.`
    );
  }
};
