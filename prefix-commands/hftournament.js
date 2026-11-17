const E = require('../utils/emojis');
const HFTournament = require('../models/HFTournament');
const HFTournamentAccess = require('../models/HFTournamentAccess');
const HFTournamentAward = require('../models/HFTournamentAward');
const TournamentStats = require('../models/TournamentStats');
const { generateFixtures } = require('../utils/hfFixtures');
const { getAccess, hasHFPermission, isBotOwner } = require('../utils/hfPermissions');
const { reportToMainServer } = require('../utils/hfOwnerReports');

function getMentionedId(message, value) {
  return message.mentions.users.first()?.id || String(value || '').match(/\d{15,25}/)?.[0] || '';
}

async function getCurrentTournament(message) {
  return HFTournament.findOne({
    guildId: message.guild.id,
    status: { $in: ['registration', 'active'] }
  }).sort({ createdAt: -1 });
}

function stripMention(args) {
  return args.filter(value => !/<@!?\d+>/.test(value)).join(' ').trim();
}

function normalizeType(value) {
  const type = String(value || '').trim().toLowerCase();
  if (['league', 'cup', 'groups_knockout', 'group', 'groups', 'group stages', 'groupstage'].includes(type)) {
    return type === 'league' ? 'league' : type === 'cup' ? 'cup' : 'groups_knockout';
  }
  return '';
}

function prompt(message, text, collectorState) {
  return message.channel.send(text).then(sent => {
    collectorState.messages.push(sent);
    return sent;
  });
}

async function collectCreate(message) {
  const state = { messages: [] };
  const questions = [
    `${E.calendar || '📅'} Enter the tournament name.`,
    `${E.trophy || '🏆'} Enter the type: \`league\`, \`cup\`, or \`groups\` for group stages then knockouts.`,
    `${E.team || '⚽'} Enter team names separated by commas.`
  ];
  const answers = [];
  for (const question of questions) {
    const promptMessage = await prompt(message, question, state);
    const collected = await new Promise(resolve => {
      const collector = message.channel.createMessageCollector({
        filter: reply => reply.author.id === message.author.id,
        time: 60000,
        max: 1
      });
      collector.on('collect', reply => {
        state.messages.push(reply);
        resolve(reply.content.trim());
        collector.stop('answered');
      });
      collector.on('end', (_, reason) => {
        if (reason === 'time') resolve('');
      });
    });
    await promptMessage.delete().catch(() => null);
    if (!collected) {
      await Promise.all(state.messages.map(item => item.delete?.().catch(() => null)));
      return null;
    }
    answers.push(collected);
  }
  await Promise.all(state.messages.map(item => item.delete?.().catch(() => null)));
  const type = normalizeType(answers[1]);
  const teams = answers[2].split(',').map(name => name.trim()).filter(Boolean);
  if (!type || teams.length < 2) return null;
  return { name: answers[0], type, teams };
}

async function createTournament(message) {
  if (!(await hasHFPermission(message, 'createTournament'))) {
    return message.reply(`${E.wrong} Only the bot owner or an authorized HF admin can create tournaments.`);
  }
  const openTournament = await HFTournament.findOne({
    guildId: message.guild.id,
    status: { $in: ['registration', 'active'] }
  });
  if (openTournament) {
    return message.reply(`${E.warning} This server already has open tournament **${openTournament.name}** (\`${openTournament.tournamentId}\`). End it before creating another.`);
  }
  const input = await collectCreate(message);
  if (!input) return message.reply(`${E.wrong} Tournament creation cancelled or invalid. Use league, cup, or groups and provide at least two teams.`);
  const tournamentId = `hf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const fixtures = generateFixtures(input.type, input.teams.map(name => ({ name })), { groupCount: 2 });
  const tournament = await HFTournament.create({
    guildId: message.guild.id,
    tournamentId,
    name: input.name,
    type: input.type,
    createdBy: message.author.id,
    status: 'registration',
    registrationOpen: true,
    teams: input.teams.map((name, index) => ({ teamId: `team-${index + 1}`, name })),
    fixtures
  });
  return message.reply(`${E.correct || '✅'} Created **${tournament.name}** (${tournament.type}) with ID \`${tournament.tournamentId}\` and **${fixtures.length}** generated fixtures.`);
}

async function manageTeam(message, args) {
  if (!(await hasHFPermission(message, 'manageRegistration'))) return message.reply(`${E.wrong} You need HF registration access.`);
  const tournament = await getCurrentTournament(message);
  if (!tournament) return message.reply(`${E.missing} No open HF tournament is configured in this server.`);
  const knownActions = new Set(['add', 'player', 'addplayer', 'captain', 'vicecaptain', 'vice-captain']);
  const actionIndex = args.findIndex(value => knownActions.has(String(value).toLowerCase()));
  const action = String(args[actionIndex] || '').toLowerCase();
  const rest = args.slice(actionIndex + 1);
  if (action === 'add') {
    const name = rest.join(' ').trim();
    if (!name) return message.reply('Usage: `+hftournament team <id> add <team name>`');
    if (tournament.teams.some(team => team.name.toLowerCase() === name.toLowerCase())) return message.reply(`${E.warning} That team already exists.`);
    tournament.teams.push({ teamId: `team-${Date.now().toString(36)}`, name });
    await tournament.save();
    return message.reply(`${E.correct || '✅'} Added team **${name}**.`);
  }
  const userId = getMentionedId(message, args.join(' '));
  const teamName = stripMention(rest);
  const team = tournament.teams.find(item => item.name.toLowerCase() === teamName.toLowerCase());
  if (!team || !userId) return message.reply('Usage: `.hftournament team player <team name> @user` or `.addhfplayer @user Player Name`');
  if (action === 'captain' || action === 'vicecaptain' || action === 'vice-captain') {
    const field = action === 'captain' ? 'captainUserId' : 'viceCaptainUserId';
    if (tournament.teams.some(item => item[field] === userId && item.teamId !== team.teamId)) {
      return message.reply(`${E.warning} That user is already ${action === 'captain' ? 'a captain' : 'a vice captain'} in this tournament.`);
    }
    team[field] = userId;
    const roleId = action === 'captain' ? tournament.captainRoleId : tournament.viceCaptainRoleId;
    if (roleId) await message.guild.members.fetch(userId).then(member => member.roles.add(roleId)).catch(() => null);
  } else if (action === 'player' || action === 'addplayer') {
    if (!team.playerUserIds.includes(userId)) team.playerUserIds.push(userId);
    if (tournament.playerRoleId) await message.guild.members.fetch(userId).then(member => member.roles.add(tournament.playerRoleId)).catch(() => null);
  } else {
    return message.reply('Usage: `+hftournament team <id> add|captain|vicecaptain|player ...`');
  }
  await tournament.save();
  return message.reply(`${E.correct || '✅'} Updated **${team.name}**.`);
}

async function addPlayer(message, args) {
  return manageTeam(message, ['addplayer', ...args]);
}

async function grantAccess(message, args) {
  if (!isBotOwner(message.author.id)) return message.reply(`${E.wrong} Only the bot owner can grant HF access.`);
  const userId = getMentionedId(message, args[0]);
  const level = String(args[1] || 'mod').toLowerCase();
  if (!userId || !['admin', 'mod'].includes(level)) return message.reply('Usage: `+hftournament grant @user admin|mod`');
  await HFTournamentAccess.findOneAndUpdate(
    { guildId: message.guild.id, userId },
    { $set: { level, grantedBy: message.author.id } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
  return message.reply(`${E.correct || '✅'} Granted **${level}** HF access to <@${userId}> in this server.`);
}

async function awardPlayer(message, args) {
  if (!isBotOwner(message.author.id)) return message.reply(`${E.wrong} Only the bot owner can add trophies or awards.`);
  const explicitId = args[0]?.startsWith('hf-') ? args.shift() : '';
  const tournament = explicitId
    ? await HFTournament.findOne({ guildId: message.guild.id, tournamentId: explicitId })
    : await getCurrentTournament(message);
  if (!tournament) return message.reply(`${E.missing} No open HF tournament is configured in this server.`);
  const [kind, name] = args;
  const userId = getMentionedId(message, args[2]) || message.mentions.users.first()?.id;
  if (!['trophy', 'award'].includes(kind) || !name || !userId) return message.reply('Usage: `.hftournament award trophy|award <name> @user`');
  await HFTournamentAward.create({ guildId: message.guild.id, tournamentId: tournament.tournamentId, userId, name, kind, grantedBy: message.author.id });
  return message.reply(`${E.correct || '✅'} Added **${kind}** **${name}** to <@${userId}>.`);
}

async function configureTournament(message, args) {
  if (!(await hasHFPermission(message, 'createTournament'))) return message.reply(`${E.wrong} You need HF admin access.`);
  const [setting, value] = args;
  const tournament = await getCurrentTournament(message);
  if (!tournament) return message.reply(`${E.missing} No open HF tournament is configured in this server.`);
  const channelId = message.mentions.channels.first()?.id || String(value || '').match(/\d{15,25}/)?.[0] || '';
  const roleId = message.mentions.roles.first()?.id || String(value || '').match(/\d{15,25}/)?.[0] || '';
  const channelSettings = { stats: 'statsChannelId', result: 'resultChannelId', reserve: 'reserveChannelId' };
  const roleSettings = { player: 'playerRoleId', captain: 'captainRoleId', vicecaptain: 'viceCaptainRoleId', lock: 'lockRoleId' };
  if (channelSettings[setting]) tournament[channelSettings[setting]] = channelId;
  else if (roleSettings[setting]) tournament[roleSettings[setting]] = roleId;
  else return message.reply('Usage: `+hftournament configure <id> stats|result|reserve|player|captain|vicecaptain|lock <#channel|@role>`');
  await tournament.save();
  return message.reply(`${E.correct || '✅'} Updated **${setting}** for **${tournament.name}**.`);
}

async function setRegistration(message, args) {
  if (!(await hasHFPermission(message, 'manageRegistration'))) return message.reply(`${E.wrong} You need HF registration access.`);
  const value = args[0];
  const tournament = await getCurrentTournament(message);
  if (!tournament) return message.reply(`${E.missing} No open HF tournament is configured in this server.`);
  if (/^(on|open|true)$/i.test(value || '')) {
    const otherOpenTournament = await HFTournament.findOne({
      guildId: message.guild.id,
      status: { $in: ['registration', 'active'] },
      tournamentId: { $ne: tournament.tournamentId }
    });
    if (otherOpenTournament) return message.reply(`${E.warning} **${otherOpenTournament.name}** is already open in this server. End it first.`);
  }
  tournament.registrationOpen = /^(on|open|true)$/i.test(value || '');
  tournament.status = tournament.registrationOpen ? 'registration' : 'active';
  await tournament.save();
  return message.reply(`${E.correct || '✅'} Registration is now **${tournament.registrationOpen ? 'open' : 'closed'}**.`);
}

async function linkLegacyStats(message, args) {
  if (!(await hasHFPermission(message, 'manageStats'))) return message.reply(`${E.wrong} You need HF admin/mod stats access.`);
  const explicitId = args[0]?.startsWith('hf-') ? args[0] : '';
  const tournament = explicitId
    ? await HFTournament.findOne({ guildId: message.guild.id, tournamentId: explicitId })
    : await getCurrentTournament(message);
  if (!tournament) return message.reply(`${E.missing} No open HF tournament is configured in this server.`);
  const userId = getMentionedId(message, explicitId ? args[1] : args[0]);
  const filter = {
    tournamentId: null,
    $or: [
      { guildId: message.guild.id },
      { guildId: 'legacy' },
      { guildId: { $exists: false } }
    ]
  };
  if (userId) filter.userId = userId;
  const result = await TournamentStats.updateMany(filter, { $set: { guildId: message.guild.id, tournamentId: tournament.tournamentId } });
  return message.reply(`${E.correct || '✅'} Linked **${result.modifiedCount}** legacy stat row(s) to \`${tournament.tournamentId}\`.`);
}

async function applyPenalty(message, args) {
  if (!(await hasHFPermission(message, 'createTournament'))) {
    return message.reply(`${E.wrong} Only the bot owner or an authorized HF admin can change team points.`);
  }

  const explicitId = args[0]?.startsWith('hf-') ? args.shift() : '';
  const tournament = explicitId
    ? await HFTournament.findOne({ guildId: message.guild.id, tournamentId: explicitId })
    : await getCurrentTournament(message);
  const [pointsText, ...teamParts] = args;
  const adjustment = Number(pointsText);
  const teamName = teamParts.join(' ').trim();
  if (!tournament || !Number.isInteger(adjustment) || adjustment === 0 || !teamName) {
    return message.reply('Usage: `.hftournament penalty <points> <team name>` (example: `penalty -3 Team One`)');
  }
  const team = tournament.teams.find(item => item.name.toLowerCase() === teamName.toLowerCase());
  if (!team) return message.reply(`${E.missing} Team **${teamName}** was not found in this tournament.`);

  let standing = tournament.standings.find(item => item.teamId === team.teamId);
  if (!standing) {
    tournament.standings.push({ teamId: team.teamId, teamName: team.name });
    standing = tournament.standings[tournament.standings.length - 1];
  }
  standing.points += adjustment;
  standing.pointAdjustments += adjustment;
  await tournament.save();

  const direction = adjustment > 0 ? 'added to' : 'removed from';
  const report = `⚖️ **HF point adjustment**\nServer: **${message.guild.name}** (${message.guild.id})\nTournament: **${tournament.name}** (\`${tournament.tournamentId}\`)\nTeam: **${team.name}**\nPoints: **${adjustment > 0 ? '+' : ''}${adjustment}** (${direction} team)\nNew total: **${standing.points}**\nChanged by: <@${message.author.id}>`;
  await reportToMainServer(message.client, report);
  return message.reply(`${E.correct || '✅'} Applied **${adjustment > 0 ? '+' : ''}${adjustment}** points to **${team.name}**. New total: **${standing.points}**.`);
}

async function cleanupTournament(message, args) {
  if (!(await hasHFPermission(message, 'createTournament'))) {
    return message.reply(`${E.wrong} Only the bot owner or an authorized HF admin can clean up tournaments.`);
  }
  const explicitId = args[0]?.startsWith('hf-') ? args[0] : '';
  const tournament = explicitId
    ? await HFTournament.findOne({ guildId: message.guild.id, tournamentId: explicitId })
    : await getCurrentTournament(message);
  if (!tournament) return message.reply(`${E.missing} No open HF tournament is configured in this server.`);

  const fixturesRemoved = tournament.fixtures.length;
  const standingsRemoved = tournament.standings.length;
  tournament.fixtures = [];
  tournament.standings = [];
  tournament.status = 'ended';
  tournament.registrationOpen = false;
  tournament.endedAt = new Date();
  await tournament.save();

  const report = `🧹 **HF tournament cleanup**\nServer: **${message.guild.name}** (${message.guild.id})\nTournament: **${tournament.name}** (\`${tournament.tournamentId}\`)\nRemoved: **${fixturesRemoved} fixtures**, **${standingsRemoved} standings rows**\nPlayer stats were preserved.\nCleaned by: <@${message.author.id}>`;
  await reportToMainServer(message.client, report);
  return message.reply(`${E.correct || '✅'} Cleaned **${tournament.name}**. Removed ${fixturesRemoved} fixtures and ${standingsRemoved} standings rows. Player stats were preserved.`);
}

module.exports = {
  name: 'hftournament',
  aliases: ['hftour', 'hftournaments'],
  usesHFTournamentContext: false,
  async execute(message, args) {
    if (!message.guild) return message.reply(`${E.wrong} This command can only be used in a server.`);
    if (!args[0] || args[0].toLowerCase() === 'create') return createTournament(message);
    const action = args[0].toLowerCase();
    if (action === 'grant') return grantAccess(message, args.slice(1));
    if (action === 'award') return awardPlayer(message, args.slice(1));
    if (action === 'linkstats') return linkLegacyStats(message, args.slice(1));
    if (action === 'configure') return configureTournament(message, args.slice(1));
    if (action === 'registration') return setRegistration(message, args.slice(1));
    if (action === 'team') return manageTeam(message, args.slice(1));
    if (action === 'addplayer') return addPlayer(message, args.slice(1));
    if (action === 'penalty') return applyPenalty(message, args.slice(1));
    if (action === 'cleanup') return cleanupTournament(message, args.slice(1));
    if (action === 'end' || action === 'reset') {
      if (!(await hasHFPermission(message, 'createTournament'))) return message.reply(`${E.wrong} Only the bot owner or an authorized HF admin can do that.`);
      if (action === 'end') return cleanupTournament(message, [args[1]]);
      const explicitId = args[1]?.startsWith('hf-') ? args[1] : '';
      const tournament = explicitId
        ? await HFTournament.findOne({ guildId: message.guild.id, tournamentId: explicitId })
        : await getCurrentTournament(message);
      if (!tournament) return message.reply(`${E.missing} No open HF tournament is configured in this server.`);
      if (action === 'end') {
        tournament.status = 'ended';
        tournament.endedAt = new Date();
      } else {
        tournament.status = 'registration';
        tournament.registrationOpen = true;
        tournament.fixtures.forEach(fixture => {
          fixture.status = 'upcoming';
          fixture.homeScore = null;
          fixture.awayScore = null;
        });
        await TournamentStats.updateMany({ guildId: message.guild.id, tournamentId: tournament.tournamentId }, { $set: { matches: 0, goals: 0, assists: 0, mvps: 0, hattricks: 0, interceptions: 0, tackles: 0, saves: 0, ratingAverage: null, ratingMatches: 0 } });
      }
      await tournament.save();
      return message.reply(`${E.correct || '✅'} Tournament **${tournament.name}** was ${action === 'end' ? 'ended' : 'reset'}.`);
    }
    return message.reply('Usage: `+hftournament create`, `grant`, `award`, `linkstats`, `configure`, `registration`, `team`, `end`, or `reset`.');
  }
};
