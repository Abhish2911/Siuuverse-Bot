const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} = require('discord.js');
const TournamentStats = require('../models/TournamentStats');
const E = require('../utils/emojis');
const {
  loadHandFootballData,
  findPlayerByUserId,
  mentionUser,
  toNumber,
  truncateField
} = require('../utils/handfootball');

const STAT_DEFS = {
  matches: {
    label: 'Matches',
    emoji: E.played,
    aliases: ['match', 'mp', 'played'],
    value: stats => toNumber(stats.matches)
  },
  goals: {
    label: 'Goals',
    emoji: E.goal,
    aliases: ['goal', 'g'],
    value: stats => toNumber(stats.goals)
  },
  assists: {
    label: 'Assists',
    emoji: E.assist,
    aliases: ['assist', 'a'],
    value: stats => toNumber(stats.assists)
  },
  ga: {
    label: 'G+A',
    emoji: E.fire,
    aliases: ['g+a', 'g/a', 'contributions'],
    value: stats => toNumber(stats.goals) + toNumber(stats.assists)
  },
  mvps: {
    label: 'MVPs',
    emoji: E.mvp,
    aliases: ['mvp', 'motm', 'manofthematch'],
    value: stats => toNumber(stats.mvps)
  },
  hattricks: {
    label: 'Hattricks',
    emoji: E.trophy,
    aliases: ['hattrick', 'hat-tricks', 'hat-trick'],
    value: stats => toNumber(stats.hattricks)
  },
  saves: {
    label: 'Saves',
    emoji: E.save,
    aliases: ['save'],
    value: stats => toNumber(stats.saves)
  },
  tackles: {
    label: 'Tackles',
    emoji: E.tackle,
    aliases: ['tackle'],
    value: stats => toNumber(stats.tackles)
  },
  interceptions: {
    label: 'Interceptions',
    emoji: E.interception,
    aliases: ['interception', 'ints', 'int'],
    value: stats => toNumber(stats.interceptions)
  }
};

const PER_PAGE = 10;

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function getStatDef(input) {
  const selected = String(input || 'goals').trim().toLowerCase();

  for (const [key, def] of Object.entries(STAT_DEFS)) {
    if (selected === key || def.aliases.includes(selected)) {
      return { key, ...def };
    }
  }

  return { key: 'goals', ...STAT_DEFS.goals };
}

function buildControls(statKey, page, totalPages, ownerId) {
  const statSelect = new StringSelectMenuBuilder()
    .setCustomId(`hfleaderboard_select_${ownerId}`)
    .setPlaceholder('Choose a leaderboard stat')
    .addOptions(
      Object.entries(STAT_DEFS).map(([key, stat]) => ({
        label: stat.label,
        value: key,
        emoji: safeEmoji(stat.emoji, undefined),
        default: key === statKey
      }))
    );

  const previous = new ButtonBuilder()
    .setCustomId(`hfleaderboard_prev_${statKey}_${page}_${ownerId}`)
    .setLabel('Previous')
    .setEmoji(safeEmoji(E.leftArrow, '⬅️'))
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page <= 0);

  const next = new ButtonBuilder()
    .setCustomId(`hfleaderboard_next_${statKey}_${page}_${ownerId}`)
    .setLabel('Next')
    .setEmoji(safeEmoji(E.rightArrow, '➡️'))
    .setStyle(ButtonStyle.Primary)
    .setDisabled(page >= totalPages - 1);

  return [
    new ActionRowBuilder().addComponents(statSelect),
    new ActionRowBuilder().addComponents(previous, next)
  ];
}

async function buildLeaderboardPayload({ statInput, page = 0, ownerId }) {
  const stat = getStatDef(statInput);
  const [data, statsRows] = await Promise.all([
    loadHandFootballData(),
    TournamentStats.find({}).lean()
  ]);

  const ranked = statsRows
    .map(stats => ({
      stats,
      player: findPlayerByUserId(data.players, stats.userId),
      value: stat.value(stats)
    }))
    .filter(row => row.value > 0)
    .sort((left, right) => {
      if (right.value !== left.value) return right.value - left.value;
      return String(left.player?.player || left.stats.userId)
        .localeCompare(String(right.player?.player || right.stats.userId));
    });

  if (!ranked.length) {
    return {
      content: `${safeEmoji(E.missing, '⚠️')} No HandFootball ${stat.label} stats found yet.`,
      components: []
    };
  }

  const totalPages = Math.max(1, Math.ceil(ranked.length / PER_PAGE));
  const currentPage = Math.max(0, Math.min(Number(page) || 0, totalPages - 1));
  const start = currentPage * PER_PAGE;
  const pageRows = ranked.slice(start, start + PER_PAGE);
  const playerWidth = Math.max(...pageRows.map(row => String(row.player?.player || 'Unknown Player').length), 1);
  const valueWidth = Math.max(...pageRows.map(row => String(row.value).length), 1);
  const lines = pageRows.map((row, index) => {
    const playerName = row.player?.player || 'Unknown Player';
    const rank = start + index + 1;
    const name = playerName.padEnd(playerWidth, ' ');
    const value = String(row.value).padStart(valueWidth, ' ');
    return `\`#${String(rank).padEnd(2, ' ')} ${name}  ${value}\` ${mentionUser(row.stats.userId)}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`${safeEmoji(stat.emoji, '')} HandFootball ${stat.label} Leaderboard`)
    .setDescription(truncateField(lines.join('\n'), 4096))
    .setColor(0xF1C40F)
    .setFooter({
      text: `Page ${currentPage + 1}/${totalPages} • ${ranked.length} players • Use the menu to change stats`
    })
    .setTimestamp();

  return {
    embeds: [embed],
    components: buildControls(stat.key, currentPage, totalPages, ownerId)
  };
}

module.exports = {
  name: 'hfleaderboard',
  aliases: ['hflb', 'hfrank'],

  async execute(message, args) {
    return message.reply(await buildLeaderboardPayload({
      statInput: args[0],
      ownerId: message.author.id
    }));
  },

  async buttonHandler(interaction, action, statKey, page, ownerId) {
    const currentPage = Number.parseInt(page, 10) || 0;
    const nextPage = action === 'prev' ? currentPage - 1 : currentPage + 1;

    return buildLeaderboardPayload({
      statInput: statKey,
      page: nextPage,
      ownerId
    });
  },

  async selectHandler(interaction, statKey, ownerId) {
    return buildLeaderboardPayload({
      statInput: statKey,
      page: 0,
      ownerId
    });
  }
};
