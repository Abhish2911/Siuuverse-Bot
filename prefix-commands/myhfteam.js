const { EmbedBuilder } = require('discord.js');
const E = require('../utils/emojis');
const {
  loadHandFootballData,
  findPlayerByUserId,
  findPlayerByName,
  findTeamByName,
  findTeamMeta,
  getTeamRoster,
  getTeamCaptains,
  mentionUser,
  getMentionedUserId,
  getFirstIdArg,
  getSearchText,
  truncateField
} = require('../utils/handfootball');

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function getTeamColor(message, roleId) {
  const role = roleId ? message.guild?.roles?.cache?.get(roleId) : null;
  return role?.color || 0xF1C40F;
}

function parseHexColor(value) {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? Number.parseInt(color.slice(1), 16) : null;
}

function formatRoster(roster) {
  if (!roster.length) {
    return 'No players registered.';
  }

  return roster
    .map((player, index) => {
      const captain = player.isCaptain ? ` ${safeEmoji(E.captain, 'Captain')}` : '';
      return `${index + 1}. **${player.player}**${captain} (${mentionUser(player.userId)})`;
    })
    .join('\n');
}

function resolveTeam(data, message, args) {
  const mentionedUserId = getMentionedUserId(message);
  const idArg = getFirstIdArg(args);
  const searchText = getSearchText(args);

  if (mentionedUserId || idArg) {
    const player = findPlayerByUserId(data.players, mentionedUserId || idArg);
    return {
      teamName: player?.team || '',
      player
    };
  }

  if (searchText) {
    const team = findTeamByName(data, searchText);
    if (team) {
      return {
        teamName: team.team,
        player: null
      };
    }

    const player = findPlayerByName(data.players, searchText);
    return {
      teamName: player?.team || '',
      player
    };
  }

  const player = findPlayerByUserId(data.players, message.author.id);
  return {
    teamName: player?.team || '',
    player
  };
}

module.exports = {
  name: 'myhfteam',
  aliases: ['hfteam', 'hfsquad', 'myteam'],

  async execute(message, args) {
    const data = await loadHandFootballData();
    const { teamName } = resolveTeam(data, message, args);

    if (!teamName) {
      return message.reply(`${E.missing} HandFootball team not found.`);
    }

    const roster = getTeamRoster(data.players, teamName);
    const teamMeta = findTeamMeta(data.teams, teamName);
    const captains = getTeamCaptains(data.players, teamName);
    const roleText = teamMeta.roleId ? `<@&${teamMeta.roleId}>` : 'Not linked';
    const color = parseHexColor(teamMeta.color) || getTeamColor(message, teamMeta.roleId);

    const embed = new EmbedBuilder()
      .setTitle(`${safeEmoji(E.team, 'Team')} ${teamName}`)
      .setColor(color)
      .addFields(
        {
          name: 'Team Info',
          value: [
            `Captain${captains.length === 1 ? '' : 's'}: ${captains.length ? captains.map(captain => `${mentionUser(captain.userId)} (${captain.player})`).join(', ') : 'Not set'}`,
            `Stadium: ${teamMeta.stadium || 'Not set'}`,
            `Role: ${roleText}`,
            `Players: **${roster.length}**`
          ].join('\n'),
          inline: false
        },
        {
          name: 'Squad',
          value: truncateField(formatRoster(roster)),
          inline: false
        }
      )
      .setFooter({
        text: `HandFootball League • Requested by ${message.author.username}`
      })
      .setTimestamp();

    if (teamMeta.logoUrl) {
      embed.setThumbnail(teamMeta.logoUrl);
    }

    return message.reply({ embeds: [embed] });
  }
};
