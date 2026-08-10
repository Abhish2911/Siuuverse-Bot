const { EmbedBuilder } = require('discord.js');
const TournamentStats = require('../models/TournamentStats');
const E = require('../utils/emojis');
const {
  loadHandFootballData,
  findPlayerByUserId,
  findPlayerByName,
  mentionUser,
  getMentionedUserId,
  getFirstIdArg,
  getSearchText
} = require('../utils/handfootball');

const ZERO_STATS = {
  matches: 0,
  goals: 0,
  assists: 0,
  mvps: 0,
  interceptions: 0,
  tackles: 0,
  saves: 0
};

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function resolvePlayer(data, message, args) {
  const mentionedUserId = getMentionedUserId(message);
  const idArg = getFirstIdArg(args);
  const searchText = getSearchText(args);

  if (mentionedUserId || idArg) {
    return findPlayerByUserId(data.players, mentionedUserId || idArg);
  }

  if (searchText) {
    return findPlayerByName(data.players, searchText);
  }

  return findPlayerByUserId(data.players, message.author.id);
}

async function getAvatarUrl(client, userId, fallbackUser) {
  if (!userId) {
    return fallbackUser.displayAvatarURL({ extension: 'png', size: 256 });
  }

  try {
    const user = await client.users.fetch(userId);
    return user.displayAvatarURL({ extension: 'png', size: 256 });
  } catch {
    return fallbackUser.displayAvatarURL({ extension: 'png', size: 256 });
  }
}

module.exports = {
  name: 'myhfstats',
  aliases: ['hfstats', 'hfprofile'],

  async execute(message, args, client) {
    const data = await loadHandFootballData();
    const player = resolvePlayer(data, message, args);

    if (!player) {
      return message.reply(`${E.missing} HandFootball player not found.`);
    }

    const savedStats = await TournamentStats.findOne({
      userId: player.userId
    }).lean();

    const stats = {
      ...ZERO_STATS,
      ...(savedStats || {})
    };

    const goals = toNumber(stats.goals);
    const assists = toNumber(stats.assists);
    const ga = goals + assists;
    const avatarUrl = await getAvatarUrl(client, player.userId, message.author);
    const leagueName = process.env.HF_LEAGUE_NAME || 'Siuuverse HandFootball League';

    const embed = new EmbedBuilder()
      .setTitle(`${safeEmoji(E.profile, 'Profile')} ${player.team} Profile`)
      .setDescription(
        `**PLAYER CARD: ${player.player.toUpperCase()}**\n` +
        `Tournament: **${leagueName}**`
      )
      .setColor(0xF1C40F)
      .setThumbnail(avatarUrl)
      .addFields(
        {
          name: 'Player Info',
          value: [
            `User: ${mentionUser(player.userId)}`,
            `Team: **${player.team}**`,
            `Captain: **${player.isCaptain ? 'Yes' : 'No'}**`
          ].join('\n'),
          inline: false
        },
        {
          name: `${safeEmoji(E.played, 'Matches')} Matches Played`,
          value: String(toNumber(stats.matches)),
          inline: true
        },
        {
          name: `${safeEmoji(E.goal, 'Goals')} Goals`,
          value: String(goals),
          inline: true
        },
        {
          name: `${safeEmoji(E.assist, 'Assists')} Assists`,
          value: String(assists),
          inline: true
        },
        {
          name: `${safeEmoji(E.mvp, 'MVPs')} MVPs`,
          value: String(toNumber(stats.mvps)),
          inline: true
        },
        {
          name: `${safeEmoji(E.save, 'Saves')} Saves`,
          value: String(toNumber(stats.saves)),
          inline: true
        },
        {
          name: `${safeEmoji(E.tackle, 'Tackles')} Tackles`,
          value: String(toNumber(stats.tackles)),
          inline: true
        },
        {
          name: `${safeEmoji(E.interception, 'Interceptions')} Interceptions`,
          value: String(toNumber(stats.interceptions)),
          inline: true
        },
        {
          name: `${safeEmoji(E.fire, 'G+A')} G+A`,
          value: String(ga),
          inline: true
        }
      )
      .setFooter({
        text: `${message.author.username} • HandFootball stats`
      })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }
};
