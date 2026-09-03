const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits
} = require('discord.js');
const PenaltyRoyaleGame = require('../models/PenaltyRoyaleGame');
const PenaltyRoyaleProfile = require('../models/PenaltyRoyaleProfile');
const E = require('./emojis');

const DIRECTIONS = {
  left: 'Left',
  center: 'Center',
  right: 'Right'
};

// Keep the player-facing DM numbering explicit instead of deriving it from
// object position: 1 is always Left, 2 Center, and 3 Right.
const NUMBERED_DIRECTIONS = {
  1: 'left',
  2: 'center',
  3: 'right'
};
const DIRECTION_NUMBERS = {
  left: 1,
  center: 2,
  right: 3
};

const ABILITY_DEFS = {
  read: {
    label: 'Read',
    emoji: E.prRead,
    aliases: ['read'],
    description: 'Use while predicting to privately learn one corner the shooter did not choose.'
  },
  superSave: {
    label: 'Super Save',
    emoji: E.save,
    aliases: ['supersave', 'super-save', 'super'],
    description: 'Use during the shooter/GK phase to guarantee the save.'
  },
  precision: {
    label: 'Precision',
    emoji: E.prPrecision,
    aliases: ['precision'],
    description: 'Use before shooting to ignore the goalkeeper’s correct read.'
  },
  fakeShot: {
    label: 'Fake Shot',
    emoji: E.prFakeShot,
    aliases: ['fakeshot', 'fake-shot', 'fake'],
    description: 'Use before shooting to publicly display a false corner to defenders.'
  },
  rebound: {
    label: 'Rebound',
    emoji: E.prRebound,
    aliases: ['rebound'],
    description: 'Arm before shooting; if the penalty is saved and you survive, shoot again immediately.'
  }
};

const CHAOS_DEFS = {
  golden: {
    label: 'Golden Penalty',
    emoji: E.prGolden,
    description: 'A successful penalty counts as two goals.'
  },
  sudden: {
    label: 'Sudden Death',
    emoji: E.prSudden,
    description: 'In Royale mode, one saved shot eliminates the shooter.'
  },
  blind: {
    label: 'Blind Penalty',
    emoji: E.prBlind,
    description: 'Public results hide the shot corner, so players cannot learn shooting patterns.'
  }
};

const GOAL_GIFS = {
  left: 'https://klipy.com/gifs/ishowspeed-first-goal',
  center: 'https://klipy.com/gifs/penalty-kicks',
  right: 'https://klipy.com/gifs/ronaldo-penalty-ronaldo-penalty-vs-roma-1'
};
const SAVE_GIFS = {
  left: 'https://klipy.com/gifs/neuer-manuel-neuer-3',
  center: 'https://klipy.com/gifs/kepa-save',
  right: 'https://klipy.com/gifs/gianluigi-buffon-gigi-buffon'
};

const ACTIVE_STATUSES = ['lobby', 'shooting', 'predicting'];
const DEFAULT_ROUND_TIMEOUT_MS = Math.max(10_000, Number(process.env.PR_ROUND_TIMEOUT_MS) || 30_000);
const LOBBY_TIMEOUT_MS = 600_000;
// A lobby-selected chaos mode remains enabled for the entire match. Positive
// round numbers continue to represent one-round modes selected mid-match.
const FULL_MATCH_CHAOS_ROUND = -1;
const roundTimers = new Map();
const lobbyTimers = new Map();

class GameActionError extends Error {}

function parseDirection(input) {
  const value = String(input || '').trim().toLowerCase();
  const aliases = {
    l: 'left',
    left: 'left',
    c: 'center',
    centre: 'center',
    center: 'center',
    r: 'right',
    right: 'right'
  };
  return aliases[value] || '';
}

function parseAbility(input) {
  const value = String(input || '').trim().toLowerCase();
  for (const [key, ability] of Object.entries(ABILITY_DEFS)) {
    if (value === key.toLowerCase() || ability.aliases.includes(value)) return key;
  }
  return '';
}

function parseChaosMode(input) {
  const value = String(input || '').trim().toLowerCase();
  const aliases = {
    golden: 'golden',
    gold: 'golden',
    sudden: 'sudden',
    'sudden-death': 'sudden',
    blind: 'blind',
    random: 'random'
  };
  return aliases[value] || '';
}

function normalizeChaosMode(mode) {
  // Double Goal was retired. Treat a legacy active game as Golden Penalty
  // until it is saved and the schema hook persists the migration.
  return mode === 'double' ? 'golden' : String(mode || '');
}

function getActiveChaos(game) {
  const mode = normalizeChaosMode(game.chaosMode);
  return CHAOS_DEFS[mode] && (
    Number(game.chaosRound) === FULL_MATCH_CHAOS_ROUND
    || Number(game.chaosRound) === Number(game.round)
  )
    ? mode
    : '';
}

function getSelectedLobbyChaos(game) {
  const mode = normalizeChaosMode(game.chaosMode);
  return game.status === 'lobby'
    && CHAOS_DEFS[mode]
    // Recognize an opening-round selection made before this change as well.
    && [FULL_MATCH_CHAOS_ROUND, 1].includes(Number(game.chaosRound))
    ? mode
    : '';
}

function isMatchChaos(game) {
  return Boolean(game.chaosMode) && Number(game.chaosRound) === FULL_MATCH_CHAOS_ROUND;
}

function getStartingLives(game) {
  return Math.min(5, Math.max(1, Number(game?.startingLives) || 3));
}

function getRoundTimeoutSeconds(game) {
  const fallback = Math.round(DEFAULT_ROUND_TIMEOUT_MS / 1000);
  return Math.min(120, Math.max(10, Number(game?.roundTimeoutSeconds) || fallback));
}

function getRoundTimeoutMs(game) {
  return getRoundTimeoutSeconds(game) * 1000;
}

function setRoundDeadline(game) {
  game.roundDeadlineAt = new Date(Date.now() + getRoundTimeoutMs(game));
}

function clearRoundDeadline(game) {
  game.roundDeadlineAt = null;
}

function clearRoundTimer(gameId) {
  const timer = roundTimers.get(String(gameId));
  if (timer) clearTimeout(timer);
  roundTimers.delete(String(gameId));
}

function setLobbyDeadline(game) {
  game.lobbyDeadlineAt = new Date(Date.now() + LOBBY_TIMEOUT_MS);
}

function clearLobbyDeadline(game) {
  game.lobbyDeadlineAt = null;
}

function clearLobbyTimer(gameId) {
  const timer = lobbyTimers.get(String(gameId));
  if (timer) clearTimeout(timer);
  lobbyTimers.delete(String(gameId));
}

function randomAbility() {
  const abilities = Object.keys(ABILITY_DEFS);
  return abilities[Math.floor(Math.random() * abilities.length)];
}

function displayName(memberOrUser) {
  return String(memberOrUser?.displayName || memberOrUser?.globalName || memberOrUser?.username || 'Unknown player').slice(0, 80);
}

function mention(userId) {
  return `<@${userId}>`;
}

function getPlayer(game, userId) {
  return game.players.find(player => player.userId === String(userId)) || null;
}

function getAbilityCount(player, ability) {
  return Math.max(0, Number(player?.abilities?.[ability]) || 0);
}

function grantAbility(player, ability, amount = 1) {
  if (!ABILITY_DEFS[ability]) throw new GameActionError('That ability does not exist.');
  if (!player.abilities) player.abilities = {};
  player.abilities[ability] = getAbilityCount(player, ability) + Math.max(1, Number(amount) || 1);
}

function grantRandomAbility(player) {
  const ability = randomAbility();
  grantAbility(player, ability);
  return ability;
}

function assignRandomAbilities(game, players = game.players) {
  return players.map(player => ({
    player,
    ability: grantRandomAbility(player)
  }));
}

async function notifyAbilityAssignments(client, assignments) {
  if (!client || !Array.isArray(assignments)) return { delivered: 0, failed: assignments?.length || 0 };

  const results = await Promise.all(assignments.map(async assignment => {
    const { player, ability } = assignment;
    try {
      const user = await client.users.fetch(player.userId);
      await user.send(
        `${E.trophy} **Penalty Royale — Secret Ability**\n` +
        `${ABILITY_DEFS[ability].emoji} You received **${ABILITY_DEFS[ability].label}**.\n` +
        `${ABILITY_DEFS[ability].description}\n\n` +
        'Keep it secret until the perfect moment.'
      );
      return { delivered: true, assignment };
    } catch {
      return { delivered: false, assignment };
    }
  }));

  const failedAssignments = results
    .filter(result => !result.delivered)
    .map(result => result.assignment);
  const delivered = results.length - failedAssignments.length;
  return { delivered, failed: failedAssignments.length, failedAssignments };
}

async function sendDmFallback(channel, failedAssignments) {
  if (!failedAssignments?.length) return false;
  const players = failedAssignments.map(({ player }) => mention(player.userId)).join(', ');
  await channel?.send(
    `${E.warning} ${players}, I could not DM your secret ability. Enable DMs from server members, then ask the host to use \`.prrerollability @player\` before Round 1 resolves.`
  ).catch(() => null);
  return true;
}

async function sendAbilityInventory(client, player) {
  const user = await client?.users?.fetch(player.userId).catch(() => null);
  if (!user) return false;

  const inventory = Object.entries(ABILITY_DEFS)
    .filter(([key]) => getAbilityCount(player, key) > 0)
    .map(([key, ability]) => `${ability.emoji} **${ability.label} ×${getAbilityCount(player, key)}** — ${ability.description}`);

  try {
    await user.send(
      `${E.trophy} **Penalty Royale — Secret Ability Inventory**\n` +
      (inventory.length ? inventory.join('\n') : 'You have no unused special abilities.')
    );
    return true;
  } catch {
    return false;
  }
}

function consumeAbility(player, ability) {
  if (getAbilityCount(player, ability) < 1) {
    throw new GameActionError(`You do not have a ${ABILITY_DEFS[ability].label} ability.`);
  }
  player.abilities[ability] = getAbilityCount(player, ability) - 1;
}

function recordAbilityUse(player) {
  player.abilitiesUsed = Math.max(0, Number(player.abilitiesUsed) || 0) + 1;
}

function isAlive(player) {
  return player && player.lives > 0;
}

function alivePlayers(game) {
  return game.players.filter(isAlive);
}

function isManager(messageOrInteraction, game) {
  const userId = messageOrInteraction.author?.id || messageOrInteraction.user?.id;
  return userId === game.hostId
    || Boolean(messageOrInteraction.member?.permissions?.has(PermissionFlagsBits.ManageGuild));
}

function canCancelGame(messageOrInteraction, game) {
  const userId = messageOrInteraction.author?.id || messageOrInteraction.user?.id;
  const botOwnerIds = String(process.env.OWNER_IDS || process.env.OWNER_ID || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
  return userId === game.hostId
    || userId === messageOrInteraction.guild?.ownerId
    || botOwnerIds.includes(userId)
    || Boolean(messageOrInteraction.member?.permissions?.has(PermissionFlagsBits.Administrator));
}

function hearts(lives, maxLives = 3) {
  const filled = E.prHeart.repeat(Math.max(0, Number(lives) || 0));
  const empty = E.prEmptyHeart.repeat(Math.max(0, maxLives - (Number(lives) || 0)));
  return filled + empty || E.prEmptyHeart.repeat(maxLives);
}

function playerLine(player, index, showLives = true, maxLives = 3) {
  const shield = player.shields ? ` ${E.prShield}${player.shields}` : '';
  const team = player.team ? ` **${player.team}**` : '';
  return `${index + 1}. ${mention(player.userId)}${team}${showLives ? ` ${hearts(player.lives, maxLives)}` : ''}${shield}`;
}

function teamPlayers(game, team) {
  return game.players.filter(player => player.team === team);
}

function teamTurnOrder(game) {
  const a = teamPlayers(game, 'A');
  const b = teamPlayers(game, 'B');
  const order = [];
  const limit = Math.max(a.length, b.length);

  for (let index = 0; index < limit; index += 1) {
    if (a[index]) order.push(a[index]);
    if (b[index]) order.push(b[index]);
  }

  return order;
}

function nextPlayerAfter(players, previousId) {
  if (!players.length) return null;
  const previousIndex = players.findIndex(player => player.userId === previousId);
  return players[(previousIndex + 1 + players.length) % players.length];
}

function getDefenders(game) {
  const shooter = getPlayer(game, game.shooterId);
  if (!shooter) return [];

  if (game.mode === 'teams') {
    const defendingTeam = shooter.team === 'A' ? 'B' : 'A';
    return teamPlayers(game, defendingTeam);
  }

  return alivePlayers(game).filter(player => player.userId !== shooter.userId);
}

function getGoalkeeper(game) {
  return getPlayer(game, game.goalkeeperId);
}

function getPredictors(game) {
  return getDefenders(game).filter(player => player.userId !== game.goalkeeperId);
}

function chooseFirstShooter(game) {
  if (game.mode === 'teams') return teamTurnOrder(game)[0] || null;
  return alivePlayers(game)[0] || null;
}

function chooseNextShooter(game) {
  if (game.mode === 'teams') {
    return nextPlayerAfter(teamTurnOrder(game), game.lastShooterId);
  }

  return nextPlayerAfter(alivePlayers(game), game.lastShooterId);
}

function chooseGoalkeeper(game, shooter) {
  if (!shooter) return null;
  if (game.mode === 'teams') {
    const defendingTeam = shooter.team === 'A' ? 'B' : 'A';
    const keepers = teamPlayers(game, defendingTeam);
    if (!game.lastGoalkeeperByTeam) game.lastGoalkeeperByTeam = { a: '', b: '' };
    const previous = game.lastGoalkeeperByTeam?.[defendingTeam.toLowerCase()] || '';
    const goalkeeper = nextPlayerAfter(keepers, previous);
    if (goalkeeper) game.lastGoalkeeperByTeam[defendingTeam.toLowerCase()] = goalkeeper.userId;
    return goalkeeper;
  }

  const goalkeeper = nextPlayerAfter(alivePlayers(game), game.lastGoalkeeperId || shooter.userId);
  if (goalkeeper?.userId === shooter.userId) return null;
  if (goalkeeper) game.lastGoalkeeperId = goalkeeper.userId;
  return goalkeeper;
}

function assignGoalkeeper(game, shooter) {
  const goalkeeper = chooseGoalkeeper(game, shooter);
  game.goalkeeperId = goalkeeper?.userId || '';
  return goalkeeper;
}

function buildLobbyButtons(game) {
  if (game.mode === 'teams') {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`pr_lobby_${game._id}_join_A`)
        .setLabel('Join Team A')
        .setEmoji(E.team)
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`pr_lobby_${game._id}_join_B`)
        .setLabel('Join Team B')
        .setEmoji(E.team)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`pr_lobby_${game._id}_start`)
        .setLabel('Start')
        .setEmoji(E.trophy)
        .setStyle(ButtonStyle.Success)
    );
  }

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pr_lobby_${game._id}_join`)
      .setLabel('Join game')
      .setEmoji(E.goal)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`pr_lobby_${game._id}_start`)
      .setLabel('Start')
      .setEmoji(E.trophy)
      .setStyle(ButtonStyle.Primary)
  );
}

function buildGamePayload(game, options = {}) {
  const controls = options.controls !== false;
  const shooter = getPlayer(game, game.shooterId);
  const goalkeeper = getGoalkeeper(game);
  const baseDescription = [];

  if (game.lastRoundSummary) {
    baseDescription.push(`> ${game.lastRoundSummary}`);
  }

  const activeChaos = getActiveChaos(game);
  if (activeChaos) {
    const chaos = CHAOS_DEFS[activeChaos];
    baseDescription.push(`${chaos.emoji} **CHAOS ROUND — ${chaos.label}**\n${chaos.description}`);
  }

  if (game.status === 'lobby') {
    baseDescription.push(
      `**${game.players.length}/${game.maxPlayers} players joined**\n` +
      (game.mode === 'teams'
        ? 'Join **Team A** or **Team B**. The host can start once both teams have four players.'
        : `Join the lobby. The host can start with 2–8 players. Everyone starts with **${getStartingLives(game)} lives**.`)
    );
    const lobbyDeadline = game.lobbyDeadlineAt?.getTime?.();
    baseDescription.push(
      `${E.prTimer} **Settings:** ${getRoundTimeoutSeconds(game)}s per choice` +
      (game.mode === 'royale' ? ` • ${getStartingLives(game)} lives` : '') +
      (lobbyDeadline ? `\nLobby auto-cancels if not started <t:${Math.floor(lobbyDeadline / 1000)}:R>.` : '')
    );
    const selectedChaos = getSelectedLobbyChaos(game);
    if (selectedChaos) {
      const chaos = CHAOS_DEFS[selectedChaos];
      baseDescription.push(`${chaos.emoji} **MATCH MODE SELECTED — ${chaos.label}**\n${chaos.description}`);
    }
  } else if (game.status === 'shooting') {
    baseDescription.push(
      `**Round ${game.round}${game.teamTiebreaker ? ' — SUDDEN-DEATH TIEBREAKER' : ''}**\n${E.scorer} Shooter: ${mention(shooter.userId)}\n` +
      `${E.goalkeeper} Goalkeeper: ${goalkeeper ? mention(goalkeeper.userId) : '—'}\n` +
      `${mention(shooter.userId)} and ${goalkeeper ? mention(goalkeeper.userId) : 'the goalkeeper'} have been sent a private numbered prompt.`
    );
  } else if (game.status === 'predicting') {
    const defenders = getDefenders(game);
    const predictors = getPredictors(game);
    const fakeShot = game.fakeShotDirection
      ? `\n${E.prFakeShot} **Fake Shot shown:** ${DIRECTIONS[game.fakeShotDirection]}`
      : '';
    baseDescription.push(
      `**Round ${game.round}${game.teamTiebreaker ? ' — SUDDEN-DEATH TIEBREAKER' : ''}**\n${E.scorer} Shooter: ${mention(shooter.userId)}\n` +
      `${E.goalkeeper} Goalkeeper: ${goalkeeper ? mention(goalkeeper.userId) : '—'}\n` +
      `${E.prPrediction} Choices locked in: **${game.predictions.length}/${defenders.length}** (${predictors.length} predictor${predictors.length === 1 ? '' : 's'})\n` +
      `${defenders.map(player => mention(player.userId)).join(' ') || 'No defenders remain'} — predictors have been sent a private numbered prompt.` +
      fakeShot
    );
  } else if (game.status === 'finished') {
    const winnerText = game.winnerIds.length
      ? game.winnerIds.map(mention).join(', ')
      : 'No winner — the match ended level.';
    baseDescription.push(`**Game complete**\n${E.trophy} Winner${game.winnerIds.length === 1 ? '' : 's'}: ${winnerText}`);
  } else {
    baseDescription.push('This game was cancelled.');
  }

  const embed = new EmbedBuilder()
    .setTitle(`${E.trophy} PENALTY ROYALE`)
    .setColor(game.status === 'finished' ? 0xF1C40F : 0x5865F2)
    .setDescription(baseDescription.join('\n\n'))
    .setFooter({
      text: game.mode === 'teams'
        ? 'Team mode • Use .prabilities to view your abilities'
        : 'Royale mode • Correct predictions earn shields • Use .prabilities for abilities'
    })
    .setTimestamp();

  if (game.mode === 'teams') {
    const teamA = teamPlayers(game, 'A');
    const teamB = teamPlayers(game, 'B');
    embed.addFields(
      {
        name: `${E.team} TEAM A — ${game.teamScores.a}`,
        value: teamA.map((player, index) => playerLine(player, index, false)).join('\n') || '—',
        inline: true
      },
      {
        name: `${E.team} TEAM B — ${game.teamScores.b}`,
        value: teamB.map((player, index) => playerLine(player, index, false)).join('\n') || '—',
        inline: true
      }
    );
  } else {
    const sortedPlayers = [...game.players].sort((left, right) => {
      if (right.lives !== left.lives) return right.lives - left.lives;
      return left.displayName.localeCompare(right.displayName);
    });
    embed.addFields({
      name: `Players remaining: ${alivePlayers(game).length}`,
      value: sortedPlayers.map((player, index) => playerLine(player, index, true, getStartingLives(game))).join('\n') || '—'
    });
  }

  const components = [];
  if (controls && game.status === 'lobby') {
    components.push(buildLobbyButtons(game));
  }

  return { embeds: [embed], components };
}

async function findActiveGame(guildId, channelId) {
  return PenaltyRoyaleGame.findOne({
    guildId: String(guildId),
    channelId: String(channelId),
    status: { $in: ACTIVE_STATUSES }
  }).sort({ createdAt: -1 });
}

async function createGame({ guildId, channelId, hostId, hostName, mode, startingLives = 3, roundTimeoutSeconds = 30 }) {
  const existing = await findActiveGame(guildId, channelId);
  if (existing) {
    throw new GameActionError('A Penalty Royale game is already active in this channel. Use `.prstatus` to view it.');
  }

  const initialTeam = mode === 'teams' ? 'A' : '';
  const normalizedLives = Math.min(5, Math.max(1, Number(startingLives) || 3));
  const normalizedTimeout = Math.min(120, Math.max(10, Number(roundTimeoutSeconds) || 30));
  return PenaltyRoyaleGame.create({
    guildId: String(guildId),
    channelId: String(channelId),
    hostId: String(hostId),
    mode,
    startingLives: normalizedLives,
    roundTimeoutSeconds: normalizedTimeout,
    lobbyDeadlineAt: new Date(Date.now() + LOBBY_TIMEOUT_MS),
    players: [{
      userId: String(hostId),
      displayName: hostName,
      team: initialTeam,
      lives: normalizedLives
    }]
  });
}

function selectTeam(game, requestedTeam) {
  if (game.mode !== 'teams') return '';

  const requested = String(requestedTeam || '').trim().toUpperCase();
  const sizeA = teamPlayers(game, 'A').length;
  const sizeB = teamPlayers(game, 'B').length;

  if (requested && !['A', 'B'].includes(requested)) {
    throw new GameActionError('Choose team `A` or `B`, for example `.prjoin A`.');
  }

  const team = requested || (sizeA <= sizeB ? 'A' : 'B');
  const size = team === 'A' ? sizeA : sizeB;
  if (size >= 4) {
    throw new GameActionError(`Team ${team} is already full. Join the other team instead.`);
  }
  return team;
}

function addPlayer(game, { userId, name, team }) {
  if (game.status !== 'lobby') {
    throw new GameActionError('This game has already started.');
  }
  if (getPlayer(game, userId)) {
    throw new GameActionError('You are already in this game.');
  }
  if (game.players.length >= game.maxPlayers) {
    throw new GameActionError('This lobby is full.');
  }

  const assignedTeam = selectTeam(game, team);
  game.players.push({
    userId: String(userId),
    displayName: name,
    team: assignedTeam,
    lives: getStartingLives(game)
  });
  return assignedTeam;
}

function startGame(game, actor) {
  if (!isManager(actor, game)) {
    throw new GameActionError('Only the host or a server manager can start this game.');
  }
  if (game.status !== 'lobby') {
    throw new GameActionError('This game has already started.');
  }
  if (game.mode === 'teams') {
    if (teamPlayers(game, 'A').length !== 4 || teamPlayers(game, 'B').length !== 4) {
      throw new GameActionError('Team mode needs exactly four players on Team A and four on Team B.');
    }
  } else if (game.players.length < 2) {
    throw new GameActionError('At least two players are required to start a Royale game.');
  }

  const shooter = chooseFirstShooter(game);
  if (!shooter) throw new GameActionError('There are not enough players to start this game.');
  const hasOpeningChaos = Boolean(getSelectedLobbyChaos(game));

  game.status = 'shooting';
  game.phase = 'shooting';
  clearLobbyDeadline(game);
  game.round = 1;
  game.shooterId = shooter.userId;
  assignGoalkeeper(game, shooter);
  clearRoundAbilities(game);
  // A host may select a match-wide chaos mode in the lobby. Retain it for
  // every round; all other stale chaos state is cleared normally.
  if (hasOpeningChaos) game.chaosRound = FULL_MATCH_CHAOS_ROUND;
  else clearChaosRound(game);
  setRoundDeadline(game);
  const assignments = assignRandomAbilities(game);
  game.lastRoundSummary = 'The shootout has begun! Every player received one secret ability by DM. Build a 3-streak of goals, goalkeeper saves, or correct predictions to earn extra abilities.';
  return assignments;
}

function clearRoundAbilities(game) {
  game.precisionActive = false;
  game.fakeShotActive = false;
  game.fakeShotDirection = '';
  game.reboundArmedBy = '';
  game.superSaveArmedBy = '';
}

function clearChaosRound(game) {
  game.chaosMode = '';
  game.chaosRound = 0;
}

function armChaosRound(game, input) {
  const selectingLobby = game.status === 'lobby';
  if (!selectingLobby && game.status !== 'shooting') {
    throw new GameActionError('Chaos modes can be selected in the lobby or before the shooter selects a corner.');
  }
  if (!selectingLobby && game.shot) throw new GameActionError('This round already has a locked shot.');

  const parsed = parseChaosMode(input);
  if (!parsed) throw new GameActionError('Choose golden, sudden, blind, or random.');
  const allowed = Object.keys(CHAOS_DEFS).filter(mode => game.mode === 'royale' || mode !== 'sudden');
  const mode = parsed === 'random'
    ? allowed[Math.floor(Math.random() * allowed.length)]
    : parsed;
  if (!allowed.includes(mode)) {
    throw new GameActionError('Sudden Death is available only in Royale mode.');
  }

  game.chaosMode = mode;
  game.chaosRound = selectingLobby ? FULL_MATCH_CHAOS_ROUND : game.round;
  return mode;
}

function useAbility(game, userId, ability) {
  const player = getPlayer(game, userId);
  if (!player) throw new GameActionError('You are not a player in this game.');
  if (!ABILITY_DEFS[ability]) throw new GameActionError('That ability does not exist.');

  if (ability === 'read') {
    if (game.status !== 'predicting') throw new GameActionError('Read can only be used while defenders are predicting.');
    if (!getPredictors(game).some(predictor => predictor.userId === player.userId)) {
      throw new GameActionError('Only a predictor can use Read this round.');
    }
    if (game.predictions.some(prediction => prediction.userId === player.userId)) {
      throw new GameActionError('Use Read before locking in your prediction.');
    }
    consumeAbility(player, ability);
    recordAbilityUse(player);
    const impossibleShots = Object.keys(DIRECTIONS).filter(direction => direction !== game.shot);
    const clue = impossibleShots[Math.floor(Math.random() * impossibleShots.length)];
    return {
      notice: `${E.prRead} **Read:** the shot is not **${DIRECTIONS[clue]}**.`,
      autoPrediction: false
    };
  }

  if (ability === 'superSave') {
    if (game.status !== 'shooting') throw new GameActionError('Super Save can only be used during the shooter/GK phase.');
    if (game.goalkeeperId !== player.userId) {
      throw new GameActionError('Only the assigned goalkeeper can use Super Save this round.');
    }
    if (game.predictions.some(prediction => prediction.userId === player.userId)) {
      throw new GameActionError('Your prediction is already locked in.');
    }
    consumeAbility(player, ability);
    recordAbilityUse(player);
    game.superSaveArmedBy = player.userId;
    if (game.shot) lockGoalkeeperChoice(game, player.userId, game.shot);
    return {
      notice: `${E.save} **Super Save:** your guaranteed save is armed.`,
      autoPrediction: true
    };
  }

  if (game.status !== 'shooting') {
    throw new GameActionError(`${ABILITY_DEFS[ability].label} can only be used before the shooter chooses a corner.`);
  }
  if (game.shooterId !== player.userId) {
    throw new GameActionError('Only the current shooter can use that ability.');
  }

  if (ability === 'precision') {
    if (game.precisionActive) throw new GameActionError('Precision is already active this round.');
    consumeAbility(player, ability);
    recordAbilityUse(player);
    game.precisionActive = true;
    return {
      notice: `${E.prPrecision} **Precision active:** the goalkeeper’s correct read will be ignored.`,
      autoPrediction: false
    };
  }

  if (ability === 'fakeShot') {
    if (game.fakeShotActive) throw new GameActionError('Fake Shot is already armed this round.');
    consumeAbility(player, ability);
    recordAbilityUse(player);
    game.fakeShotActive = true;
    return {
      notice: `${E.prFakeShot} **Fake Shot armed:** defenders will see a false corner after you shoot.`,
      autoPrediction: false
    };
  }

  if (ability === 'rebound') {
    if (game.reboundArmedBy) throw new GameActionError('Rebound is already armed this round.');
    consumeAbility(player, ability);
    recordAbilityUse(player);
    game.reboundArmedBy = player.userId;
    return {
      notice: `${E.prRebound} **Rebound armed:** if this penalty is saved and you survive, you shoot again immediately.`,
      autoPrediction: false
    };
  }

  throw new GameActionError('That ability cannot be used right now.');
}

function lockShot(game, userId, direction) {
  if (game.status !== 'shooting') {
    throw new GameActionError('The game is not waiting for a shot.');
  }
  if (game.shooterId !== String(userId)) {
    throw new GameActionError('Only the current shooter can choose a corner.');
  }
  if (!parseDirection(direction)) {
    throw new GameActionError('Choose Left, Center, or Right.');
  }

  game.shot = parseDirection(direction);
  if (game.fakeShotActive) {
    const fakeChoices = Object.keys(DIRECTIONS).filter(directionKey => directionKey !== game.shot);
    game.fakeShotDirection = fakeChoices[Math.floor(Math.random() * fakeChoices.length)];
  }
  if (game.superSaveArmedBy && game.goalkeeperId) {
    lockGoalkeeperChoice(game, game.goalkeeperId, game.shot);
  }
  moveToPredictingIfReady(game);
  game.lastRoundSummary = game.status === 'predicting'
    ? `${E.lock} Shooter and goalkeeper are ready. Predictors, check your DMs and choose a corner!`
    : `${E.lock} The shooter has locked in a choice. Waiting for the goalkeeper's private reply.`;
}

function moveToPredictingIfReady(game) {
  const hasGoalkeeperChoice = game.predictions.some(prediction => prediction.userId === game.goalkeeperId);
  if (!game.shot || !hasGoalkeeperChoice) return false;
  game.status = 'predicting';
  game.phase = 'predicting';
  setRoundDeadline(game);
  return true;
}

function lockGoalkeeperChoice(game, userId, direction) {
  if (game.status !== 'shooting') {
    throw new GameActionError('The goalkeeper can only choose during the shooter/GK phase.');
  }
  if (game.goalkeeperId !== String(userId)) {
    throw new GameActionError('Only the assigned goalkeeper can make the save choice.');
  }
  if (!parseDirection(direction)) {
    throw new GameActionError('Choose 1, 2, or 3.');
  }
  if (game.predictions.some(prediction => prediction.userId === String(userId))) {
    throw new GameActionError('Your goalkeeper choice is already locked in.');
  }
  game.predictions.push({ userId: String(userId), choice: parseDirection(direction) });
  const goalkeeper = getPlayer(game, userId);
  if (goalkeeper) goalkeeper.predictions += 1;
  return moveToPredictingIfReady(game);
}

function lockPrediction(game, userId, direction) {
  if (game.status !== 'predicting') {
    throw new GameActionError('The game is not waiting for predictor choices.');
  }
  if (!parseDirection(direction)) {
    throw new GameActionError('Choose Left, Center, or Right.');
  }

  const predictor = getPredictors(game).find(player => player.userId === String(userId));
  if (!predictor) {
    throw new GameActionError('Only an active predictor can make a choice this round.');
  }
  if (game.predictions.some(prediction => prediction.userId === String(userId))) {
    throw new GameActionError('Your prediction is already locked in.');
  }

  game.predictions.push({ userId: String(userId), choice: parseDirection(direction) });
  predictor.predictions += 1;
}

function allDefendersPredicted(game) {
  const defenders = getDefenders(game);
  return defenders.length === game.predictions.length;
}

function addGoalRewards(shooter) {
  const previousStreak = shooter.goalStreak;
  // Count successful penalties, not bonus scoreboard goals from Golden
  // Penalty. Exactly three scored penalties produce the streak reward.
  shooter.goalStreak += 1;
  shooter.bestGoalStreak = Math.max(shooter.bestGoalStreak, shooter.goalStreak);
  let ability = '';

  if (Math.floor(shooter.goalStreak / 3) > Math.floor(previousStreak / 3)) {
    ability = grantRandomAbility(shooter);
    return {
      text: ` ${E.fire} 3-penalty streak: a secret ability was awarded!`,
      ability
    };
  }

  return { text: '', ability };
}

function finishRoyaleIfNeeded(game) {
  const alive = alivePlayers(game);
  if (alive.length > 1) return false;

  game.status = 'finished';
  game.phase = 'finished';
  clearRoundDeadline(game);
  game.winnerIds = alive.map(player => player.userId);
  if (alive[0]) {
    game.lastRoundSummary += ` ${E.trophy} ${mention(alive[0].userId)} is the last player standing!`;
  }
  return true;
}

function finishTeamsIfNeeded(game) {
  const completed = game.players.every(player => player.attempts >= 1);
  if (!completed) return false;

  if (!game.teamTiebreaker) {
    if (game.teamScores.a === game.teamScores.b) {
      game.teamTiebreaker = true;
      game.tiebreakerShots = { a: 0, b: 0 };
      game.lastRoundSummary += ` ${E.prSudden} Scores are level — sudden-death tiebreaker begins!`;
      return false;
    }
    return finishTeamsWithWinner(game);
  }

  const tiebreakerShots = game.tiebreakerShots || { a: 0, b: 0 };
  if (
    tiebreakerShots.a > 0
    && tiebreakerShots.a === tiebreakerShots.b
    && game.teamScores.a !== game.teamScores.b
  ) {
    return finishTeamsWithWinner(game);
  }
  return false;
}

function finishTeamsWithWinner(game) {
  game.status = 'finished';
  game.phase = 'finished';
  clearRoundDeadline(game);
  if (game.teamScores.a > game.teamScores.b) {
    game.winnerIds = teamPlayers(game, 'A').map(player => player.userId);
    game.lastRoundSummary += ` ${E.trophy} TEAM A WINS!`;
  } else {
    game.winnerIds = teamPlayers(game, 'B').map(player => player.userId);
    game.lastRoundSummary += ` ${E.trophy} TEAM B WINS!`;
  }
  return true;
}

function beginNextRound(game) {
  const nextShooter = chooseNextShooter(game);
  if (!nextShooter) {
    game.status = 'finished';
    game.phase = 'finished';
    clearRoundDeadline(game);
    game.winnerIds = [];
    return;
  }

  game.round += 1;
  game.shooterId = nextShooter.userId;
  assignGoalkeeper(game, nextShooter);
  game.status = 'shooting';
  game.phase = 'shooting';
  game.shot = '';
  game.predictions = [];
  clearRoundAbilities(game);
  if (!isMatchChaos(game)) clearChaosRound(game);
  setRoundDeadline(game);
}

function beginReboundRound(game, shooter) {
  game.round += 1;
  game.shooterId = shooter.userId;
  assignGoalkeeper(game, shooter);
  game.status = 'shooting';
  game.phase = 'shooting';
  game.shot = '';
  game.predictions = [];
  clearRoundAbilities(game);
  if (!isMatchChaos(game)) clearChaosRound(game);
  setRoundDeadline(game);
}

function resolveRound(game, { fillMissingPredictions = false } = {}) {
  if (game.status !== 'predicting') {
    throw new GameActionError('There is no prediction round to resolve.');
  }

  const shooter = getPlayer(game, game.shooterId);
  const defenders = getDefenders(game);
  let goalkeeper = getGoalkeeper(game);
  if (!goalkeeper && shooter) goalkeeper = assignGoalkeeper(game, shooter);
  if (!shooter || !goalkeeper || !game.shot) {
    throw new GameActionError('The current round is incomplete.');
  }

  if (fillMissingPredictions) {
    for (const defender of defenders) {
      if (!game.predictions.some(prediction => prediction.userId === defender.userId)) {
        // Keep a placeholder only to let the round finish. It is deliberately
        // not counted in the player's profile as a real prediction.
        game.predictions.push({ userId: defender.userId, choice: 'missed' });
      }
    }
  }

  if (!allDefendersPredicted(game)) {
    throw new GameActionError(`Waiting for ${defenders.length - game.predictions.length} more defender prediction(s).`);
  }

  const predictors = getPredictors(game);
  const goalkeeperPrediction = game.predictions.find(prediction => prediction.userId === goalkeeper.userId);
  const goalkeeperCorrect = goalkeeperPrediction?.choice === game.shot;
  const correctPredictors = predictors.filter(predictor => game.predictions.some(
    prediction => prediction.userId === predictor.userId && prediction.choice === game.shot
  ));
  let precisionBlocked = null;
  if (game.precisionActive && goalkeeperCorrect) {
    precisionBlocked = goalkeeper;
  }
  const saved = goalkeeperCorrect && !precisionBlocked;
  const chaosMode = getActiveChaos(game);
  const goalValue = chaosMode === 'golden' ? 2 : 1;
  const suddenDeath = saved && chaosMode === 'sudden' && game.mode === 'royale';
  let shieldUsed = false;
  let lifeLost = false;
  let rewardText = '';
  let reboundActivated = false;
  const earnedAbilities = [];

  shooter.shots += 1;
  shooter.attempts += 1;
  if (game.mode === 'teams' && game.teamTiebreaker) {
    const teamKey = shooter.team.toLowerCase();
    if (!game.tiebreakerShots) game.tiebreakerShots = { a: 0, b: 0 };
    game.tiebreakerShots[teamKey] = Math.max(0, Number(game.tiebreakerShots[teamKey]) || 0) + 1;
  }

  for (const defender of defenders) {
    const prediction = game.predictions.find(entry => entry.userId === defender.userId);
    const predicted = prediction && prediction.choice !== 'missed';
    const correct = predicted && prediction.choice === game.shot;

    if (defender.userId === goalkeeper.userId) {
      if (correct && !precisionBlocked) {
        defender.saves += 1;
        defender.correctPredictions += 1;
        defender.shields += 1;
        defender.shieldsEarned += 1;
        defender.saveStreak += 1;
        defender.bestSaveStreak = Math.max(defender.bestSaveStreak, defender.saveStreak);
        if (defender.saveStreak % 3 === 0) {
          earnedAbilities.push({ player: defender, ability: grantRandomAbility(defender) });
        }
      } else {
        defender.saveStreak = 0;
      }
      continue;
    }

    if (correct) {
      defender.correctPredictions += 1;
      defender.predictionPoints += 1;
      defender.predictionStreak += 1;
      defender.bestPredictionStreak = Math.max(defender.bestPredictionStreak, defender.predictionStreak);
      if (defender.predictionStreak % 3 === 0) {
        earnedAbilities.push({ player: defender, ability: grantRandomAbility(defender) });
      }
    } else if (predicted) {
      defender.predictionStreak = 0;
    }
  }

  if (saved) {
    shooter.misses += 1;
    shooter.goalStreak = 0;
    if (game.mode === 'royale') {
      if (suddenDeath) {
        shooter.lives = 0;
        shooter.lifeLosses += 1;
        lifeLost = true;
      } else if (shooter.shields > 0) {
        shooter.shields -= 1;
        shieldUsed = true;
      } else {
        shooter.lives = Math.max(0, shooter.lives - 1);
        shooter.lifeLosses += 1;
        lifeLost = true;
      }
    }
    if (
      game.reboundArmedBy === shooter.userId
      && !suddenDeath
      && (game.mode === 'teams' || shooter.lives > 0)
    ) {
      reboundActivated = true;
    }
  } else {
    shooter.goals += goalValue;
    const reward = addGoalRewards(shooter);
    rewardText = reward.text;
    if (reward.ability) earnedAbilities.push({ player: shooter, ability: reward.ability });
    if (game.mode === 'teams') {
      game.teamScores[shooter.team.toLowerCase()] += goalValue;
    }
  }

  const shotLabel = DIRECTIONS[game.shot];
  // The next round clears `game.shot`, so keep the resolved direction for the
  // outside-the-embed corner GIF returned below.
  const resolvedShot = game.shot;
  const blindPenalty = chaosMode === 'blind';
  const goalkeeperChoice = game.predictions.find(prediction => prediction.userId === goalkeeper.userId)?.choice;
  const mainChoicesText = blindPenalty
    ? ''
    : `\n${mention(shooter.userId)}: **${DIRECTION_NUMBERS[resolvedShot] || '—'}** | ${mention(goalkeeper.userId)}: **${DIRECTION_NUMBERS[goalkeeperChoice] || '—'}**\n`;
  const predictorPointsText = correctPredictors.length
    ? ` ${correctPredictors.map(player => mention(player.userId)).join(', ')} earned **+1 Prediction Point**.`
    : '';
  const precisionText = precisionBlocked
    ? ` ${E.prPrecision} Precision beat ${mention(precisionBlocked.userId)}'s read.`
    : '';
  if (saved) {
    const savedShotText = blindPenalty
      ? `${E.prBlind} The shot corner stays hidden.`
      : `${mention(shooter.userId)} shot ${shotLabel}.`;
    game.lastRoundSummary = `${E.save} **SAVED!** ${savedShotText} ${mention(goalkeeper.userId)} made the save and earned a shield.${mainChoicesText}${predictorPointsText}${precisionText}${suddenDeath ? ` ${E.prSudden} Sudden Death eliminates ${mention(shooter.userId)}!` : shieldUsed ? ` ${E.prShield} A shield absorbed the life loss.` : lifeLost ? ` ${mention(shooter.userId)} loses ${E.prHeart}.` : ''}${reboundActivated ? ` ${E.prRebound} Rebound! The shooter gets another attempt.` : ''}`;
  } else {
    const goalShotText = blindPenalty
      ? `${mention(shooter.userId)} scored, but the shot corner stays hidden.`
      : `${mention(shooter.userId)} scored ${shotLabel}`;
    game.lastRoundSummary = `${E.goal} **GOAL!** ${goalShotText}${goalValue > 1 ? ' for **2 goals**' : ''}.${mainChoicesText}${predictorPointsText}${precisionText}${rewardText}`;
  }

  game.roundHistory.push({
    round: game.round,
    shooterId: shooter.userId,
    shooterName: shooter.displayName,
    shooterTeam: shooter.team,
    goalkeeperId: goalkeeper.userId,
    shot: game.shot,
    saved,
    chaosMode,
    goalValue,
    suddenDeath,
    correctPredictorIds: correctPredictors.map(player => player.userId),
    lifeLost,
    shieldUsed
  });
  game.lastShooterId = shooter.userId;

  const finished = reboundActivated
    ? false
    : game.mode === 'royale'
      ? finishRoyaleIfNeeded(game)
      : finishTeamsIfNeeded(game);

  if (!finished) {
    if (reboundActivated) beginReboundRound(game, shooter);
    else beginNextRound(game);
  }
  return {
    saved,
    finished,
    mediaUrl: saved ? SAVE_GIFS[resolvedShot] : GOAL_GIFS[resolvedShot],
    earnedAbilities
  };
}

async function applyGameStats(game) {
  if (game.status !== 'finished' || game.statsApplied) return false;

  const claimed = await PenaltyRoyaleGame.findOneAndUpdate(
    { _id: game._id, statsApplied: false },
    { $set: { statsApplied: true } },
    { new: true }
  );
  if (!claimed) return false;

  const winnerSet = new Set(game.winnerIds);
  const isDraw = game.winnerIds.length === 0;
  await Promise.all(game.players.map(async player => {
    const won = winnerSet.has(player.userId);
    const update = {
      $set: {
        displayName: player.displayName,
        lastPlayedAt: new Date()
      },
      $inc: {
        games: 1,
        wins: won ? 1 : 0,
        losses: !won && !isDraw ? 1 : 0,
        draws: isDraw ? 1 : 0,
        goals: player.goals,
        shots: player.shots,
        misses: player.misses,
        saves: player.saves,
        predictions: player.predictions,
        correctPredictions: player.correctPredictions,
        predictionPoints: player.predictionPoints,
        lifeLosses: player.lifeLosses,
        shieldsEarned: player.shieldsEarned,
        abilitiesUsed: player.abilitiesUsed
      },
      $max: {
        bestGoalStreak: player.bestGoalStreak,
        bestSaveStreak: player.bestSaveStreak,
        bestPredictionStreak: player.bestPredictionStreak
      }
    };

    const profile = await PenaltyRoyaleProfile.findOneAndUpdate(
      { guildId: game.guildId, userId: player.userId },
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const nextWinStreak = won ? (profile.currentWinStreak || 0) + 1 : 0;
    await PenaltyRoyaleProfile.updateOne(
      { _id: profile._id },
      {
        $set: { currentWinStreak: nextWinStreak },
        $max: { bestWinStreak: nextWinStreak }
      }
    );
  }));
  game.statsApplied = true;
  return true;
}

async function refreshGameMessage(client, game) {
  if (!client || !game.messageId) return false;
  const channel = await client.channels.fetch(game.channelId).catch(() => null);
  if (!channel?.messages?.fetch) return false;
  const message = await channel.messages.fetch(game.messageId).catch(() => null);
  if (!message) return false;
  await message.edit(buildGamePayload(game));
  return true;
}

async function sendRoundMedia(channel, resolution) {
  if (resolution?.mediaUrl) {
    await channel?.send(resolution.mediaUrl).catch(() => null);
  }
}

function abilityNumberLines(player, keys) {
  return keys
    .filter(key => getAbilityCount(player, key) > 0)
    .map((key, index) => `${index + 4} — ${ABILITY_DEFS[key].emoji} ${ABILITY_DEFS[key].label}`);
}

function abilityForNumber(player, keys, number) {
  const available = keys.filter(key => getAbilityCount(player, key) > 0);
  return available[number - 4] || '';
}

function numberedChoiceLines(player, abilityKeys) {
  const abilityLines = abilityNumberLines(player, abilityKeys);
  return [
    '1 — Left',
    '2 — Center',
    '3 — Right',
    ...(abilityLines.length ? ['', '**Special ability:**', ...abilityLines, 'Some abilities ask you to send 1–3 afterwards; a Super Save resolves on its own.'] : [])
  ].join('\n');
}

async function sendDmPrompt(client, player, title, abilityKeys) {
  const user = await client?.users?.fetch(player.userId).catch(() => null);
  if (!user) return false;
  return user.send(
    `${E.trophy} **Penalty Royale — ${title}**\n` +
    `Reply to this DM with a number within the round timer:\n${numberedChoiceLines(player, abilityKeys)}`
  ).then(() => true).catch(() => false);
}

async function sendRoundPrompts(client, game) {
  const channel = await client?.channels?.fetch(game.channelId).catch(() => null);
  const shooter = getPlayer(game, game.shooterId);
  const goalkeeper = getGoalkeeper(game);
  if (!channel || !shooter || !goalkeeper || !['shooting', 'predicting'].includes(game.status)) return false;

  const seconds = getRoundTimeoutSeconds(game);
  if (game.status === 'shooting') {
    const [shooterDm, goalkeeperDm] = await Promise.all([
      sendDmPrompt(client, shooter, `ROUND ${game.round} — SHOOTER`, ['precision', 'fakeShot', 'rebound']),
      sendDmPrompt(client, goalkeeper, `ROUND ${game.round} — GOALKEEPER`, ['superSave'])
    ]);
    await channel.send(
      `${mention(shooter.userId)} ${mention(goalkeeper.userId)}\n` +
      `**ROUND ${game.round}${game.teamTiebreaker ? ' — SUDDEN-DEATH TIEBREAKER' : ''}**\n` +
      `${E.scorer} Shooter and ${E.goalkeeper} goalkeeper: check your DMs and reply **1, 2, or 3** — **${seconds}s** to reply.`
    ).catch(() => null);
    const failed = [!shooterDm && shooter, !goalkeeperDm && goalkeeper].filter(Boolean);
    if (failed.length) {
      await channel.send(`${E.warning} ${failed.map(player => mention(player.userId)).join(' ')}, I could not DM you. Enable DMs from server members to play this round.`).catch(() => null);
    }
    return true;
  }

  const predictors = getPredictors(game);
  if (!predictors.length) return false;
  const dmResults = await Promise.all(predictors.map(player => sendDmPrompt(client, player, `ROUND ${game.round} — PREDICTOR`, ['read'])));
  await channel.send(
    `${predictors.map(player => mention(player.userId)).join(' ')}\n` +
    `**PREDICTORS — ROUND ${game.round}**\n` +
    `${E.prPrediction} Check your DMs and reply **1, 2, or 3** to predict the shot — **${seconds}s** to reply. Correct calls earn **+1 Prediction Point**.`
  ).catch(() => null);
  const failed = predictors.filter((_, index) => !dmResults[index]);
  if (failed.length) {
    await channel.send(`${E.warning} ${failed.map(player => mention(player.userId)).join(' ')}, I could not DM you. Enable DMs from server members to predict.`).catch(() => null);
  }
  return true;
}

async function resolveAndPublishRound(client, game, channel) {
  const resolution = resolveRound(game, { fillMissingPredictions: true });
  await game.save();
  if (game.status === 'finished') await applyGameStats(game);
  if (game.lastRoundSummary) await channel?.send(game.lastRoundSummary).catch(() => null);
  await sendRoundMedia(channel, resolution);
  if (resolution.earnedAbilities?.length) {
    const dmResults = await notifyAbilityAssignments(client, resolution.earnedAbilities);
    await sendDmFallback(channel, dmResults.failedAssignments);
  }
  if (game.status !== 'finished') await sendRoundPrompts(client, game);
  scheduleRoundTimer(client, game);
  return resolution;
}

async function handlePenaltyRoyaleDm(client, message) {
  const choice = Number(String(message.content || '').trim());
  if (!Number.isInteger(choice) || choice < 1) return false;

  const candidates = await PenaltyRoyaleGame.find({
    status: { $in: ['shooting', 'predicting'] },
    'players.userId': String(message.author.id)
  }).sort({ updatedAt: -1 }).limit(10);
  const game = candidates.find(candidate => {
    if (candidate.status === 'shooting') {
      return candidate.shooterId === message.author.id || candidate.goalkeeperId === message.author.id;
    }
    return getPredictors(candidate).some(player => player.userId === message.author.id);
  });
  if (!game) return false;

  const channel = await client?.channels?.fetch(game.channelId).catch(() => null);
  const previousStatus = game.status;
  try {
    let notice = '';
    if (game.status === 'shooting') {
      const player = getPlayer(game, message.author.id);
      const abilityKeys = game.shooterId === message.author.id
        ? ['precision', 'fakeShot', 'rebound']
        : ['superSave'];
      const ability = abilityForNumber(player, abilityKeys, choice);
      if (ability) {
        notice = useAbility(game, message.author.id, ability).notice;
      } else {
        const direction = NUMBERED_DIRECTIONS[choice];
        if (!direction) throw new GameActionError('Reply with 1, 2, or 3. Ability numbers begin at 4 when shown.');
        if (game.shooterId === message.author.id) {
          lockShot(game, message.author.id, direction);
          notice = `${E.success} Your shot is locked: **${choice} — ${DIRECTIONS[direction]}**.`;
        } else {
          lockGoalkeeperChoice(game, message.author.id, direction);
          notice = `${E.success} Your goalkeeper choice is locked: **${choice} — ${DIRECTIONS[direction]}**.`;
        }
      }
    } else {
      const player = getPlayer(game, message.author.id);
      const ability = abilityForNumber(player, ['read'], choice);
      if (ability) {
        notice = useAbility(game, message.author.id, ability).notice;
      } else {
        const direction = NUMBERED_DIRECTIONS[choice];
        if (!direction) throw new GameActionError('Reply with 1, 2, or 3. Ability number 4 is available when shown.');
        lockPrediction(game, message.author.id, direction);
        notice = `${E.success} Your predictor choice is locked: **${choice} — ${DIRECTIONS[direction]}**.`;
      }
    }

    await game.save();
    await message.react(E.success).catch(() => null);
    await message.reply(notice).catch(() => null);

    if (previousStatus === 'shooting' && game.status === 'predicting') {
      if (allDefendersPredicted(game)) await resolveAndPublishRound(client, game, channel);
      else {
        await sendRoundPrompts(client, game);
        scheduleRoundTimer(client, game);
      }
    } else if (game.status === 'predicting' && allDefendersPredicted(game)) {
      await resolveAndPublishRound(client, game, channel);
    }
    return true;
  } catch (error) {
    const text = error instanceof GameActionError ? error.message : 'That Penalty Royale reply could not be processed.';
    await message.reply(`${E.warning} ${text}`).catch(() => null);
    return true;
  }
}

async function handleRoundTimeout(client, gameId, expectedRound, expectedStatus) {
  const game = await PenaltyRoyaleGame.findById(gameId);
  if (!game || !ACTIVE_STATUSES.includes(game.status)) {
    clearRoundTimer(gameId);
    return false;
  }
  if (Number(game.round) !== Number(expectedRound) || game.status !== expectedStatus) {
    scheduleRoundTimer(client, game);
    return false;
  }

  const deadline = game.roundDeadlineAt?.getTime?.() || 0;
  if (deadline && deadline > Date.now() + 250) {
    scheduleRoundTimer(client, game);
    return false;
  }

  const channel = await client?.channels?.fetch(game.channelId).catch(() => null);
  if (game.status === 'shooting') {
    if (!game.shot) {
      const direction = Object.keys(DIRECTIONS)[Math.floor(Math.random() * Object.keys(DIRECTIONS).length)];
      lockShot(game, game.shooterId, direction);
    }
    if (!game.predictions.some(prediction => prediction.userId === game.goalkeeperId)) {
      game.predictions.push({ userId: game.goalkeeperId, choice: 'missed' });
    }
    moveToPredictingIfReady(game);
    game.lastRoundSummary = `${E.prTimer} Shooter/GK time expired. Missing choices were counted as no choice; predictors have ${getRoundTimeoutSeconds(game)} seconds.`;
    await game.save();
    if (allDefendersPredicted(game)) await resolveAndPublishRound(client, game, channel);
    else {
      await sendRoundPrompts(client, game);
      scheduleRoundTimer(client, game);
    }
    return true;
  }

  await channel?.send(`${E.prTimer} Predictor time expired. Missing choices count as no prediction.`).catch(() => null);
  await resolveAndPublishRound(client, game, channel);
  return true;
}

function scheduleRoundTimer(client, game) {
  const gameId = String(game?._id || '');
  if (!gameId) return false;
  clearRoundTimer(gameId);
  if (!ACTIVE_STATUSES.includes(game.status) || !['shooting', 'predicting'].includes(game.status)) return false;

  const deadline = game.roundDeadlineAt?.getTime?.() || (Date.now() + getRoundTimeoutMs(game));
  const delay = Math.max(250, deadline - Date.now());
  const expectedRound = game.round;
  const expectedStatus = game.status;
  const timer = setTimeout(() => {
    handleRoundTimeout(client, gameId, expectedRound, expectedStatus)
      .catch(error => console.error(`${E.cancel} Penalty Royale round timer failed:`, error));
  }, delay);
  roundTimers.set(gameId, timer);
  return true;
}

async function handleLobbyTimeout(client, gameId) {
  const game = await PenaltyRoyaleGame.findById(gameId);
  if (!game || game.status !== 'lobby') {
    clearLobbyTimer(gameId);
    return false;
  }

  const deadline = game.lobbyDeadlineAt?.getTime?.() || 0;
  if (deadline > Date.now() + 250) {
    scheduleLobbyTimer(client, game);
    return false;
  }

  game.status = 'cancelled';
  game.phase = 'finished';
  game.lastRoundSummary = `${E.prTimer} Lobby expired — this match was cancelled because it was not started within 10 minutes.`;
  clearLobbyDeadline(game);
  await game.save();
  clearLobbyTimer(gameId);
  await refreshGameMessage(client, game).catch(() => null);
  return true;
}

function scheduleLobbyTimer(client, game) {
  const gameId = String(game?._id || '');
  if (!gameId) return false;
  clearLobbyTimer(gameId);
  if (game.status !== 'lobby') return false;

  const deadline = game.lobbyDeadlineAt?.getTime?.() || (Date.now() + LOBBY_TIMEOUT_MS);
  const delay = Math.max(250, deadline - Date.now());
  const timer = setTimeout(() => {
    handleLobbyTimeout(client, gameId)
      .catch(error => console.error(`${E.cancel} Penalty Royale lobby timer failed:`, error));
  }, delay);
  lobbyTimers.set(gameId, timer);
  return true;
}

async function restorePenaltyRoyaleTimers(client) {
  const games = await PenaltyRoyaleGame.find({ status: { $in: ACTIVE_STATUSES } });
  for (const game of games) {
    if (game.status === 'lobby') {
      if (!game.lobbyDeadlineAt) {
        game.lobbyDeadlineAt = new Date((game.createdAt?.getTime?.() || Date.now()) + LOBBY_TIMEOUT_MS);
        await game.save();
      }
      scheduleLobbyTimer(client, game);
      continue;
    }
    if (['shooting', 'predicting'].includes(game.status) && !game.roundDeadlineAt) {
      setRoundDeadline(game);
      await game.save();
    }
    scheduleRoundTimer(client, game);
    await sendRoundPrompts(client, game);
  }
  return games.length;
}

function parseButtonId(customId) {
  const parts = String(customId || '').split('_');
  if (parts[0] !== 'pr') return null;
  const action = parts[1];
  const gameId = parts[2];
  const value = parts.slice(3).join('_');
  return { action, gameId, value };
}

async function handleButton(interaction) {
  const parsed = parseButtonId(interaction.customId);
  if (!parsed?.gameId) return { notice: 'That Penalty Royale button is invalid.' };

  const game = await PenaltyRoyaleGame.findById(parsed.gameId);
  if (!game || game.guildId !== interaction.guildId) {
    return { notice: 'That Penalty Royale game no longer exists.' };
  }

  try {
    if (parsed.action === 'lobby' && parsed.value.startsWith('join')) {
      const [, requestedTeam] = parsed.value.split('_');
      const team = game.mode === 'teams' ? requestedTeam : '';
      const assignedTeam = addPlayer(game, {
        userId: interaction.user.id,
        name: displayName(interaction.member || interaction.user),
        team
      });
      await game.save();
      return {
        payload: buildGamePayload(game),
        notice: `You joined${assignedTeam ? ` Team ${assignedTeam}` : ' the game'}!`
      };
    }
    if (parsed.action === 'lobby' && parsed.value === 'start') {
      const assignments = startGame(game, interaction);
      await game.save();
      clearLobbyTimer(game._id);
      const dmResults = await notifyAbilityAssignments(interaction.client, assignments);
      await sendDmFallback(interaction.channel, dmResults.failedAssignments);
      scheduleRoundTimer(interaction.client, game);
      await sendRoundPrompts(interaction.client, game);
      return {
        payload: buildGamePayload(game),
        notice: `The game has started. Starting abilities were DM'd to ${dmResults.delivered}/${assignments.length} player(s); extra abilities require a 3-streak.`
      };
    }
    if (['shot', 'predict', 'ability'].includes(parsed.action)) {
      return { notice: 'In-game choices now use numbered DM replies. Check the latest Penalty Royale DM.' };
    }
    return { notice: 'That Penalty Royale action is not recognized.' };
  } catch (error) {
    if (error instanceof GameActionError) return { notice: error.message };
    throw error;
  }
}

module.exports = {
  DIRECTIONS,
  ABILITY_DEFS,
  CHAOS_DEFS,
  GameActionError,
  PenaltyRoyaleGame,
  PenaltyRoyaleProfile,
  displayName,
  getPlayer,
  getDefenders,
  isManager,
  canCancelGame,
  parseDirection,
  parseAbility,
  parseChaosMode,
  getAbilityCount,
  grantAbility,
  grantRandomAbility,
  assignRandomAbilities,
  notifyAbilityAssignments,
  sendAbilityInventory,
  sendDmFallback,
  findActiveGame,
  createGame,
  addPlayer,
  startGame,
  armChaosRound,
  lockShot,
  lockGoalkeeperChoice,
  lockPrediction,
  moveToPredictingIfReady,
  useAbility,
  resolveRound,
  applyGameStats,
  refreshGameMessage,
  scheduleRoundTimer,
  clearRoundTimer,
  scheduleLobbyTimer,
  clearLobbyTimer,
  restorePenaltyRoyaleTimers,
  sendRoundMedia,
  sendRoundPrompts,
  resolveAndPublishRound,
  handlePenaltyRoyaleDm,
  buildGamePayload,
  GOAL_GIFS,
  SAVE_GIFS,
  handleButton
};
