const { randomUUID } = require('crypto');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const E = require('../utils/emojis');
const { models } = require('../models/SclModels');
const { target } = require('../utils/sclMongo');
const { buildSclTableImage } = require('../utils/sclTablesImage');

const CONTROL_ACTIONS = new Set(['help', 'setup', 'toggle', 'status']);
const ROUTES = {
  scl: 'help', sclhelp: 'help', sclsetup: 'setup', scltoggle: 'toggle', sclregistration: 'registration',
  sclcreateteam: 'teamcreate', sclteam: 'team', sclteams: 'teams',
  ctn: 'changeteamname', sclprofile: 'profile', sclmyteam: 'myteam', sclsetplayername: 'setplayername', sclapprove: 'approve',
  sclreject: 'reject', sclpoints: 'points', sclstandings: 'standings', sclindividuals: 'individuals', sclstatus: 'status',
  sclsetteamrole: 'setteamrole', sclsyncroles: 'syncroles'
};

function key(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function cleanId(value) { return String(value || '').replace(/[<@!>&]/g, '').trim(); }
function idsFromEnv() { return String(process.env.OWNER_IDS || '').split(',').map(value => value.trim()).filter(Boolean); }
function isOwner(message) { return idsFromEnv().includes(message.author.id) || message.guild?.ownerId === message.author.id; }
async function safeReply(message, payload) {
  try {
    return await message.reply(payload);
  } catch (error) {
    if (error?.code !== 50035 || !error?.rawError?.errors?.message_reference) throw error;
    return message.channel.send(payload);
  }
}
function mentionId(message, args = []) { return message.mentions?.users?.first()?.id || args.map(cleanId).find(value => /^\d{15,25}$/.test(value)) || ''; }
function visibleName(message, userId) {
  const member = message.guild?.members?.cache?.get(userId);
  const user = message.mentions?.users?.get(userId);
  return member?.displayName || user?.username || `Player ${userId.slice(-4)}`;
}
function requestedPlayerName(args, userId) {
  return args
    .filter(arg => !/<@!?\d+>/.test(arg) && cleanId(arg) !== userId && !/^\d{15,25}$/.test(cleanId(arg)))
    .join(' ')
    .trim();
}
function number(value) {
  const text = String(value ?? '').trim();
  if (!text) return NaN;
  const normalized = text.replace(/,/g, '').trim();
  if (!normalized) return NaN;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}
function route(message, args, invoked) {
  const known = ROUTES[String(invoked || '').toLowerCase()] || 'help';
  if (known !== 'help' || String(invoked).toLowerCase() !== 'scl') return { action: known, args };
  const action = String(args.shift() || 'help').toLowerCase();
  return { action, args };
}
async function getConfig(Config, guildId) {
  let config = await Config.findOne({ guildId });
  if (!config) config = await Config.create({ guildId });
  return config;
}
function isRef(message, config) {
  return isOwner(message)
    || Boolean(config.refereeRoleId && message.member?.roles?.cache?.has(config.refereeRoleId));
}
async function requireRef(message, config) {
  if (!isRef(message, config)) {
    await safeReply(message, `${E.error} Only an SCL referee or the bot owner can use this command.`);
    return false;
  }
  return true;
}
function commandGroup(action) {
  return ({ teamcreate: 'team', teams: 'team', myteam: 'team', changeteamname: 'team', setplayername: 'team', individuals: 'standings', setteamrole: 'team', syncroles: 'team' })[action] || action;
}
function disabled(config, action) {
  const group = commandGroup(action);
  return !CONTROL_ACTIONS.has(group) && (!config.enabled || config.disabledCommands.includes(group));
}
function playerDisplay(player) { return player?.displayName || 'Unknown player'; }
function profilePayload(player, team, user) {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setAuthor({ name: 'Siuuverse Champions League' })
    .setTitle(`${E.profile} ${playerDisplay(player)}`)
    .setThumbnail(user?.displayAvatarURL() || null)
    .addFields(
      { name: `${E.team} Team`, value: team?.name || 'Free agent', inline: true },
      { name: `${E.Stats} Team points`, value: team ? String(team.teamPoints) : '—', inline: true },
      { name: `${E.Stats} Individual points`, value: String(player.individualPoints), inline: true }
    )
    .setFooter({ text: 'SCL Player Profile' });
  return { embeds: [embed] };
}
async function findDocumentByText(Model, guildId, text) {
  const value = key(text);
  if (!value) return null;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exact = await Model.findOne({ guildId, displayName: { $regex: `^${escaped}$`, $options: 'i' } });
  if (exact) return exact;
  return Model.findOne({ guildId, displayName: { $regex: escaped, $options: 'i' } });
}
async function dm(client, userId, content) {
  if (!userId) return;
  const user = await client.users.fetch(userId);
  await user.send(content);
}
function notify(client, userId, content) {
  void dm(client, userId, content).catch(error => {
    console.error(`SCL notification failed for user ${userId}:`, error);
  });
}
async function assignPlayers(Player, guildId, players, teamId) {
  if (!players.length) return;
  await Player.bulkWrite(players.map(player => ({
    updateOne: {
      filter: { guildId, playerId: player.playerId },
      update: { $set: { teamId } }
    }
  })));
}

async function postReview(message, config, pending, modelsSet) {
  if (!config.approvalChannelId) return false;
  const channel = await message.guild.channels.fetch(config.approvalChannelId).catch(() => null);
  if (!channel?.isTextBased()) return false;
  const roster = pending.players.length
    ? pending.players.map(player => `• **${player.displayName || 'Unknown player'}**${player.userId ? ` (<@${player.userId}>)` : ''}`).join('\n')
    : '_No requested players yet_';
  const embed = new EmbedBuilder()
    .setColor(0xF1C40F)
    .setAuthor({ name: 'Siuuverse Champions League' })
    .setTitle(`${E.trophy} ${pending.requestType === 'players' ? 'Roster addition review' : 'Team registration review'}`)
    .addFields(
      { name: `${E.team} Team`, value: pending.name, inline: true },
      { name: `${E.captain} Captain`, value: `<@${pending.captainUserId}>`, inline: true },
      { name: `${E.rank} Request ID`, value: `\`${pending.requestId}\``, inline: true },
      { name: 'Requested players', value: roster, inline: false },
      { name: 'Review actions', value: `Approve: \`.sclapprove ${pending.requestId}\`\nReject: \`.sclreject ${pending.requestId} <reason>\``, inline: false }
    )
    .setFooter({ text: `Team limit: ${config.playersPerTeam} players` });
  const sent = await channel.send({ embeds: [embed] }).catch(() => null);
  if (sent) { pending.reviewMessageId = sent.id; await pending.save(); }
  return Boolean(sent);
}

function helpPayload(prefix = '.') {
  return new EmbedBuilder()
    .setColor(0x00b894)
    .setAuthor({ name: 'Siuuverse Champions League • Command Guide' })
    .setTitle(`${E.trophy} SCL Commands`)
    .setDescription('Everything you need to manage your player profile, team, and league.')
    .addFields(
      { name: `${E.profile} Player profile`, value: `\`${prefix}sclprofile\` · View team and points`, inline: true },
      { name: `${E.team} Captain`, value: `\`${prefix}sclcreateteam <name>\` · Register a team\n\`${prefix}sclteam add @player [name]\` · Request a roster addition\n\`${prefix}sclteam remove @player\` · Remove a player\n\`${prefix}ctn <new name>\` · Rename your team\n\`${prefix}sclmyteam\` · View your team roster`, inline: true },
      { name: `${E.Stats} League tables`, value: `\`${prefix}sclstandings\` · Team standings\n\`${prefix}sclindividuals\` · Player points\n\`${prefix}sclteams\` · Approved teams`, inline: true },
      { name: `${E.captain} Referees & setup`, value: `\`${prefix}sclapprove <id>\` / \`${prefix}sclreject <id> <reason>\`\n\`${prefix}sclsetplayername @player <name>\` · Rename a player (captain: own team; referee: any team)\n\`${prefix}ctn @captain <new name>\` · Rename any team (referee)\n\`${prefix}sclsetup\` · Server configuration\n\`${prefix}sclregistration open|close\` · Team registration\n\`${prefix}sclsetteamrole <team> @role\` · Link a team role\n\`${prefix}sclsyncroles\` · Sync mapped team roles`, inline: false },
    )
    .setFooter({ text: 'SCL profiles are created when a captain requests a player for a team.' });
}

async function setup(message, args, config) {
  const sub = key(args.shift());
  if (!sub || sub === 'status') {
    const embed = new EmbedBuilder()
      .setColor(config.registrationOpen ? 0x00b894 : 0xe17055)
      .setAuthor({ name: 'Siuuverse Champions League • Control panel' })
      .setTitle(`${E.Stats} SCL Setup`)
      .addFields(
        { name: `${E.locked} Registration`, value: config.registrationOpen ? `${E.success} Open` : `${E.error} Closed`, inline: true },
        { name: `${E.team} Team size`, value: `${config.playersPerTeam} players`, inline: true },
        { name: `${E.captain} Referee role`, value: config.refereeRoleId ? `<@&${config.refereeRoleId}>` : 'Not configured', inline: false },
        { name: `${E.profile} Approval channel`, value: config.approvalChannelId ? `<#${config.approvalChannelId}>` : 'Not configured', inline: true },
        { name: `${E.Stats} Database`, value: target(), inline: true }
      )
      .setFooter({ text: 'Configure with .sclsetup ref, channel, or playersperteam' });
    return safeReply(message, { embeds: [embed] });
  }
  if (sub === 'ref') {
    if (!isOwner(message)) return safeReply(message, `${E.error} Only the bot owner or server owner can set the SCL referee role.`);
    const operation = key(args[0]);
    if (operation === 'clear') {
      config.refereeRoleId = '';
      await config.save();
      return safeReply(message, `${E.success} The SCL referee role has been cleared.`);
    }
    const roleId = message.mentions?.roles?.first()?.id
      || args.map(cleanId).find(value => /^\d{15,25}$/.test(value));
    if (!roleId || roleId === message.guild.id || !message.guild.roles.cache.has(roleId)) {
      return safeReply(message, `${E.warning} Usage: \`.sclsetup ref @Role\` or \`.sclsetup ref clear\`.`);
    }
    config.refereeRoleId = roleId;
    await config.save();
    return safeReply(message, `${E.success} <@&${roleId}> can now use SCL referee commands.`);
  }
  if (!isRef(message, config)) return safeReply(message, `${E.error} Only an SCL referee or the bot owner can configure this SCL setting.`);
  if (sub === 'channel') {
    const channel = message.mentions?.channels?.first();
    if (!channel?.isTextBased()) return safeReply(message, `${E.warning} Usage: \`.sclsetup channel #referee-approval-channel\``);
    config.approvalChannelId = channel.id; await config.save(); return safeReply(message, `${E.success} Team approval requests will be sent to ${channel}.`);
  }
  if (sub === 'playersperteam' || sub === 'teamsize') {
    const value = number(args[0]); if (!Number.isInteger(value) || value < 1 || value > 100) return safeReply(message, `${E.warning} Enter a whole team size from 1 to 100.`);
    config.playersPerTeam = value; await config.save(); return safeReply(message, `${E.success} Team size set to **${value}**.`);
  }
  return safeReply(message, `${E.warning} Usage: \`.sclsetup ref @Role\`, \`.sclsetup channel #channel\`, or \`.sclsetup playersperteam 6\`.`);
}

async function profiles(message, args, Player, Team) {
  const targetId = mentionId(message, args) || message.author.id;
  const player = await Player.findOne({ guildId: message.guild.id, userId: targetId });
  if (!player) return safeReply(message, `${E.error} You do not have an SCL profile yet. Ask a team captain to add you with \`.sclteam add @Player\`.`);
  const [team, user] = await Promise.all([
    player.teamId ? Team.findOne({ guildId: message.guild.id, teamId: player.teamId }).select('name teamPoints').lean() : null,
    message.client.users.fetch(targetId).catch(() => null)
  ]);
  return safeReply(message, profilePayload(player, team, user));
}

async function teamCommand(message, args, config, modelsSet, directCreate = false) {
  const { Player, Team, PendingTeam } = modelsSet;
  const guildId = message.guild.id;
  const sub = directCreate ? 'create' : key(args.shift() || 'list');
  if (sub === 'list') {
    const teams = await Team.find({ guildId }).select('name captainUserId roster roleId teamPoints').sort({ teamPoints: -1 }).lean();
    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setAuthor({ name: 'Siuuverse Champions League • League directory' })
      .setTitle(`${E.team} Approved Teams`)
      .setDescription(teams.length
        ? 'Current team standings and roster sizes.'
        : 'No teams have been approved yet.')
      .setFooter({ text: `Showing top ${Math.min(teams.length, 25)} of ${teams.length} teams • Maximum ${config.playersPerTeam} players per team` });
    teams.slice(0, 25).forEach((team, index) => {
      embed.addFields({
        name: `${E.rank} ${index + 1}. ${team.name}`,
        value: `${E.captain} <@${team.captainUserId}>  •  ${team.roster.length}/${config.playersPerTeam} players  •  ${E.Stats} ${team.teamPoints} pts  •  ${team.roleId ? `<@&${team.roleId}>` : 'No role linked'}`,
        inline: false
      });
    });
    return safeReply(message, { embeds: [embed] });
  }
  if (sub === 'create') {
    if (!config.registrationOpen) return safeReply(message, `${E.locked} SCL team registration is closed.`);
    const name = (directCreate ? args : args).join(' ').trim();
    if (name.length < 2 || name.length > 50) return safeReply(message, `${E.warning} Usage: \`.sclcreateteam Team Name\` (2–50 characters).`);
    const nameKey = key(name);
    const [team, existingRequest, existingCaptain] = await Promise.all([
      Team.findOne({ guildId, nameKey }), PendingTeam.findOne({ guildId, nameKey, status: 'pending' }), Team.findOne({ guildId, captainUserId: message.author.id })
    ]);
    if (team || existingRequest) return safeReply(message, `${E.error} That team name is already approved or awaiting review.`);
    if (existingCaptain) return safeReply(message, `${E.error} You are already captain of an approved SCL team.`);
    const pending = await PendingTeam.create({ guildId, requestId: randomUUID().slice(0, 8), name, nameKey, captainUserId: message.author.id, captainName: message.member?.displayName || message.author.username, requestType: 'team' });
    const sent = await postReview(message, config, pending, modelsSet);
    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setAuthor({ name: 'Siuuverse Champions League • Registration' })
      .setTitle(`${E.calendar} Team submitted for review`)
      .setDescription(`**${name}** is now waiting for referee approval.`)
      .addFields(
        { name: `${E.rank} Request ID`, value: `\`${pending.requestId}\``, inline: true },
        { name: `${E.captain} Captain`, value: `<@${message.author.id}>`, inline: true },
        { name: 'Review channel', value: sent ? `<#${config.approvalChannelId}>` : 'Not configured — contact a referee', inline: false }
      )
      .setFooter({ text: 'You will be notified after a referee reviews the request.' });
    return safeReply(message, { embeds: [embed] });
  }
  if (sub === 'add') {
    const userId = mentionId(message, args);
    if (!userId || userId === message.author.id) return safeReply(message, `${E.warning} Usage: \`.sclteam add @player [name]\``);
    const customName = requestedPlayerName(args, userId);
    if (customName.length > 50) return safeReply(message, `${E.warning} A custom player name can be at most 50 characters.`);
    let pending = await PendingTeam.findOne({ guildId, captainUserId: message.author.id, status: 'pending' }).sort({ createdAt: -1 });
    const approvedTeam = await Team.findOne({ guildId, captainUserId: message.author.id });
    if (!pending && !approvedTeam) return safeReply(message, `${E.error} Create a team first with \`.sclcreateteam Team Name\`; its roster remains pending until referee approval.`);
    if (!pending && approvedTeam.roster.length >= config.playersPerTeam) return safeReply(message, `${E.error} **${approvedTeam.name}** has reached the ${config.playersPerTeam}-player team limit.`);
    if (!pending && approvedTeam) {
      pending = await PendingTeam.create({
        guildId,
        requestId: randomUUID().slice(0, 8),
        name: approvedTeam.name,
        nameKey: approvedTeam.nameKey,
        captainUserId: approvedTeam.captainUserId,
        captainName: approvedTeam.captainName,
        requestType: 'players'
      });
    }
    if (pending.players.some(player => player.userId === userId)) return safeReply(message, `${E.error} That player is already on this pending request.`);
    const currentCount = pending.requestType === 'players' ? approvedTeam?.roster.length || 0 : 1;
    if (currentCount + pending.players.length >= config.playersPerTeam) return safeReply(message, `${E.error} **${pending.name}** has reached the ${config.playersPerTeam}-player team limit.`);
    let player = await Player.findOne({ guildId, userId });
    if (player?.teamId || player?.captain) return safeReply(message, `${E.error} That player is already assigned to a team or is a captain.`);
    const displayName = customName || player?.displayName || visibleName(message, userId);
    if (!player) {
      player = await Player.create({ guildId, playerId: randomUUID(), userId, displayName });
    } else if (player.displayName !== displayName) {
      player.displayName = displayName;
      await player.save();
    }
    pending.players.push({ playerId: player.playerId, userId, displayName: player.displayName }); await pending.save();
    const sent = await postReview(message, config, pending, modelsSet);
    const embed = new EmbedBuilder()
      .setColor(0x0984e3)
      .setAuthor({ name: 'Siuuverse Champions League • Roster request' })
      .setTitle(`${E.success} Player submitted`)
      .setDescription(`**${player.displayName}** (<@${userId}>) was added to **${pending.name}**’s roster request.`)
      .addFields(
        { name: `${E.rank} Request ID`, value: `\`${pending.requestId}\``, inline: true },
        { name: 'Status', value: sent ? `Awaiting referee review in <#${config.approvalChannelId}>` : 'Saved; approval channel is not configured', inline: false }
      )
      .setFooter({ text: 'The player joins the team after referee approval.' });
    return safeReply(message, { embeds: [embed] });
  }
  if (sub === 'remove') {
    const userId = mentionId(message, args); if (!userId) return safeReply(message, `${E.warning} Usage: \`.sclteam remove @player\``);
    const pending = await PendingTeam.findOne({ guildId, captainUserId: message.author.id, status: 'pending' }).sort({ createdAt: -1 });
    if (pending) {
      const before = pending.players.length; pending.players = pending.players.filter(player => player.userId !== userId);
      if (before === pending.players.length) return safeReply(message, `${E.error} That player is not on your pending list.`);
      await pending.save(); await postReview(message, config, pending, modelsSet); return safeReply(message, `${E.success} Removed <@${userId}> from the pending request.`);
    }
    const team = await Team.findOne({ guildId, captainUserId: message.author.id });
    if (!team) return safeReply(message, `${E.error} You do not captain an SCL team.`);
    const rosterEntry = team.roster.find(player => player.userId === userId); if (!rosterEntry) return safeReply(message, `${E.error} That player is not on your team.`);
    team.roster = team.roster.filter(player => player.userId !== userId); await team.save();
    await Player.updateOne({ guildId, userId }, { $set: { teamId: '' } }); return safeReply(message, `${E.success} Removed <@${userId}> from **${team.name}**.`);
  }
  return safeReply(message, `${E.warning} Usage: \`.sclcreateteam Team Name\`, \`.sclteam add @player [name]\`, \`.sclteam remove @player\`, or \`.sclteams\`.`);
}

function formatTeamRoster(team) {
  const roster = [...(team.roster || [])];
  if (team.captainUserId && !roster.some(player => player.userId === team.captainUserId)) {
    roster.unshift({
      userId: team.captainUserId,
      displayName: team.captainName
    });
  }
  if (!roster.length) return ['_No roster members listed_'];

  return roster.map(player => {
    const displayName = String(player.displayName || 'Unknown player').slice(0, 80);
    const mention = player.userId ? ` (<@${player.userId}>)` : '';
    const captain = player.userId === team.captainUserId ? ' — Captain' : '';
    return `• **${displayName}**${mention}${captain}`;
  });
}

function chunkLines(lines, maxLength = 3500) {
  const chunks = [];
  let current = '';
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxLength && current) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function myTeam(message, Team) {
  const team = await Team.findOne({
    guildId: message.guild.id,
    $or: [
      { captainUserId: message.author.id },
      { 'roster.userId': message.author.id }
    ]
  }).select('name captainUserId captainName roster teamPoints roleId').lean();
  if (!team) {
    return safeReply(message, `${E.error} You are not currently on an approved SCL team. Pending roster requests do not appear here until approved.`);
  }

  const chunks = chunkLines(formatTeamRoster(team));
  for (const [index, rosterText] of chunks.entries()) {
    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setAuthor({ name: 'Siuuverse Champions League' })
      .setTitle(`${E.team} ${team.name}${index ? ' — Roster continued' : ''}`);
    if (!index) {
      embed.setDescription([
        `**Captain:** ${team.captainName} (<@${team.captainUserId}>)`,
        `**Team points:** ${team.teamPoints}`,
        team.roleId ? `**Team role:** <@&${team.roleId}>` : '',
        '',
        '**Members**',
        rosterText
      ].filter(Boolean).join('\n'));
    } else {
      embed.setDescription(rosterText);
    }
    const payload = { embeds: [embed], allowedMentions: { parse: [] } };
    if (!index) await safeReply(message, payload);
    else await message.channel.send(payload);
  }
}

async function approveRequest(message, args, config, modelsSet, reject = false) {
  if (!await requireRef(message, config)) return;
  const { Player, Team, PendingTeam } = modelsSet; const guildId = message.guild.id;
  const requestId = String(args.shift() || '').trim(); const pending = await PendingTeam.findOne({ guildId, requestId, status: 'pending' });
  if (!pending) return safeReply(message, `${E.error} Pending SCL request not found. Use the request ID shown in the approval channel.`);
  if (reject) {
    pending.status = 'rejected';
    await pending.save();
    notify(message.client, pending.captainUserId, `${E.error} Your SCL team request for **${pending.name}** was rejected${args.length ? `: ${args.join(' ')}` : '.'}`);
    return safeReply(message, `${E.success} Rejected **${pending.name}**.`);
  }
  if (pending.requestType === 'players') {
    const team = await Team.findOne({ guildId, captainUserId: pending.captainUserId, teamId: { $exists: true } });
    if (!team) return safeReply(message, `${E.error} The captain’s approved team no longer exists.`);
    if (team.roster.length + pending.players.length > config.playersPerTeam) return safeReply(message, `${E.error} This request would exceed the ${config.playersPerTeam}-player team limit.`);
    const playerIds = pending.players.map(player => player.userId).filter(Boolean);
    const conflicting = playerIds.length ? await Player.find({ guildId, userId: { $in: playerIds }, teamId: { $ne: '' } }) : [];
    if (conflicting.length) return safeReply(message, `${E.error} Cannot approve: ${conflicting.map(player => player.displayName).join(', ')} already belongs to a team.`);
    team.roster.push(...pending.players.map(player => player.toObject?.() || player));
    await team.save();
    await assignPlayers(Player, guildId, pending.players, team.teamId);
    pending.status = 'approved'; await pending.save();
    notify(message.client, pending.captainUserId, `${E.success} Your requested SCL players were added to **${team.name}**.`);
    pending.players.forEach(player => notify(message.client, player.userId, `${E.success} You were added to **${team.name}** after referee approval.`));
    return safeReply(message, `${E.success} Added ${pending.players.length} approved player(s) to **${team.name}**. Notifications are being sent.`);
  }
  if (pending.players.length + 1 > config.playersPerTeam) return safeReply(message, `${E.error} This request has ${pending.players.length + 1} players but the limit is ${config.playersPerTeam}.`);
  if (await Team.exists({ guildId, nameKey: pending.nameKey })) return safeReply(message, `${E.error} A team with this name has already been approved.`);
  const userIds = [pending.captainUserId, ...pending.players.map(player => player.userId)].filter(Boolean);
  const conflicting = await Player.find({ guildId, userId: { $in: userIds }, teamId: { $ne: '' } });
  if (conflicting.length) return safeReply(message, `${E.error} Cannot approve: ${conflicting.map(player => player.displayName).join(', ')} already belongs to a team.`);
  const captain = await Player.findOneAndUpdate({ guildId, userId: pending.captainUserId }, { $setOnInsert: { playerId: randomUUID(), displayName: pending.captainName }, $set: { captain: true } }, { upsert: true, new: true });
  const teamId = randomUUID().slice(0, 8); const roster = [{ playerId: captain.playerId, userId: captain.userId, displayName: captain.displayName }, ...pending.players];
  const team = await Team.create({ guildId, teamId, name: pending.name, nameKey: pending.nameKey, captainUserId: pending.captainUserId, captainName: pending.captainName, roster });
  captain.teamId = teamId; await captain.save();
  await assignPlayers(Player, guildId, pending.players, teamId);
  pending.status = 'approved'; await pending.save();
  notify(message.client, pending.captainUserId, `${E.success} Your SCL team **${team.name}** has been approved. Your requested players were added.`);
  pending.players.forEach(player => notify(message.client, player.userId, `${E.success} You were added to **${team.name}** after its SCL roster was approved.`));
  return safeReply(message, `${E.success} Approved **${team.name}**. The captain and ${pending.players.length} requested player(s) were added; notifications are being sent.`);
}

async function givePoints(message, args, config, modelsSet) {
  if (!await requireRef(message, config)) return;
  const { Player, Team } = modelsSet; const type = key(args.shift());
  const amountIndex = args.findIndex(arg => Number.isFinite(number(arg)));
  const amount = amountIndex === -1 ? NaN : number(args[amountIndex]);
  const beforeAmount = amountIndex === -1 ? [] : args.slice(0, amountIndex);
  if (!['team', 'player', 'individual'].includes(type) || !Number.isFinite(amount)) return safeReply(message, `${E.warning} Usage: \`.sclpoints team <team name> <points> [reason]\` or \`.sclpoints individual @user <points> [reason]\`.`);
  if (type === 'team') {
    const team = await findDocumentByText(Team, message.guild.id, beforeAmount.join(' ')); if (!team) return safeReply(message, `${E.error} Team not found.`);
    team.teamPoints += amount; await team.save(); return safeReply(message, `${E.success} **${team.name}**: ${amount >= 0 ? '+' : ''}${amount} team points.`);
  }
  const userId = mentionId(message, beforeAmount); const search = beforeAmount.filter(arg => !/<@!?(\d+)>/.test(arg) && !/^\d{15,25}$/.test(arg)).join(' ');
  const player = userId ? await Player.findOne({ guildId: message.guild.id, userId }) : await findDocumentByText(Player, message.guild.id, search);
  if (!player) return safeReply(message, `${E.error} Player not found.`); player.individualPoints += amount; await player.save(); return safeReply(message, `${E.success} **${player.displayName}**: ${amount >= 0 ? '+' : ''}${amount} individual points.`);
}

async function tables(message, modelsSet, individual = false) {
  const { Team, Player } = modelsSet; const guildId = message.guild.id;
  if (individual) {
    const rows = (await Player.find({ guildId }).select('displayName individualPoints').lean()).sort((a, b) => b.individualPoints - a.individualPoints || a.displayName.localeCompare(b.displayName)).map((player, index) => ({ rank: index + 1, name: player.displayName, points: player.individualPoints }));
    const buffer = buildSclTableImage({ title: 'SCL Individual Points', subtitle: `${rows.length} registered players`, headers: [{ key: 'rank', label: '#', width: 85 }, { key: 'name', label: 'PLAYER', width: 700 }, { key: 'points', label: 'POINTS', width: 259 }], rows });
    return safeReply(message, { files: [new AttachmentBuilder(buffer, { name: 'scl-individual-points.png' })] });
  }
  const rows = (await Team.find({ guildId }).select('name captainName roster teamPoints').lean()).sort((a, b) => b.teamPoints - a.teamPoints || a.name.localeCompare(b.name)).map((team, index) => ({ rank: index + 1, name: team.name, captain: team.captainName, players: team.roster.length, points: team.teamPoints }));
  const buffer = buildSclTableImage({ title: 'SCL Team Standings', subtitle: `${rows.length} approved teams`, headers: [{ key: 'rank', label: '#', width: 75 }, { key: 'name', label: 'TEAM', width: 380 }, { key: 'captain', label: 'CAPTAIN', width: 240 }, { key: 'players', label: 'PLAYERS', width: 160 }, { key: 'points', label: 'POINTS', width: 189 }], rows, accent: '#fbbf24' });
  return safeReply(message, { files: [new AttachmentBuilder(buffer, { name: 'scl-team-standings.png' })] });
}

async function registration(message, args, config) {
  if (!await requireRef(message, config)) return;
  const value = key(args[0]);
  if (!['open', 'close'].includes(value)) return safeReply(message, `${E.warning} Registration is **${config.registrationOpen ? 'OPEN' : 'CLOSED'}**. Use \`.sclregistration open|close\`.`);
  config.registrationOpen = value === 'open'; await config.save(); return safeReply(message, `${E.success} SCL team registration is now **${value.toUpperCase()}**.`);
}

async function changeTeamName(message, args, config, Team, PendingTeam) {
  const mentionedCaptainId = message.mentions?.users?.first()?.id || '';
  const referee = isRef(message, config);
  if (mentionedCaptainId && !referee) {
    return safeReply(message, `${E.error} Only an SCL referee or the bot owner can rename another captain's team. Use \`.ctn New Team Name\` for your own team.`);
  }

  const guildId = message.guild.id;
  const team = await Team.findOne({
    guildId,
    captainUserId: mentionedCaptainId || message.author.id
  });
  if (!team) {
    return safeReply(message, mentionedCaptainId
      ? `${E.error} No approved SCL team was found for that captain.`
      : `${E.error} You do not captain an approved SCL team. Referees can target one with \`.ctn @Captain New Team Name\`.`);
  }

  const newName = mentionedCaptainId
    ? requestedPlayerName(args, mentionedCaptainId)
    : args.join(' ').trim();
  if (newName.length < 2 || newName.length > 50) {
    return safeReply(message, `${E.warning} Use \`.ctn New Team Name\` (2–50 characters), or for referees \`.ctn @Captain New Team Name\`.`);
  }

  const newNameKey = key(newName);
  const duplicate = await Team.findOne({
    guildId,
    nameKey: newNameKey,
    teamId: { $ne: team.teamId }
  }).select('name').lean();
  if (duplicate) return safeReply(message, `${E.error} An approved team named **${duplicate.name}** already exists.`);

  const oldName = team.name;
  team.name = newName;
  team.nameKey = newNameKey;
  await team.save();

  const pendingRequests = await PendingTeam.find({
    guildId,
    captainUserId: team.captainUserId,
    requestType: 'players',
    status: 'pending'
  });
  let refreshedReviews = 0;
  for (const pending of pendingRequests) {
    pending.name = newName;
    pending.nameKey = newNameKey;
    await pending.save();
    if (await postReview(message, config, pending, { PendingTeam })) refreshedReviews += 1;
  }

  const pendingNotice = pendingRequests.length
    ? ` Updated ${pendingRequests.length} pending roster request(s)${refreshedReviews ? `; refreshed ${refreshedReviews} review notice(s)` : ''}.`
    : '';
  return safeReply(message, `${E.success} Renamed **${oldName}** to **${newName}**.${pendingNotice}`);
}

async function setPlayerName(message, args, config, Player, Team) {
  const userId = mentionId(message, args);
  const displayName = requestedPlayerName(args, userId);
  if (!userId || !displayName || displayName.length > 50) {
    return safeReply(message, `${E.warning} Usage: \`.sclsetplayername @player New Display Name\` (maximum 50 characters).`);
  }

  const guildId = message.guild.id;
  const player = await Player.findOne({ guildId, userId });
  if (!player?.teamId) return safeReply(message, `${E.error} That player is not on an approved SCL team.`);

  const team = await Team.findOne({ guildId, teamId: player.teamId });
  if (!team) return safeReply(message, `${E.error} The player's approved SCL team could not be found.`);
  if (!isRef(message, config) && team.captainUserId !== message.author.id) {
    return safeReply(message, `${E.error} Only a captain of **${team.name}**, an SCL referee, or the bot owner can rename this player.`);
  }
  const rosterEntries = team.roster.filter(entry => entry.userId === userId || entry.playerId === player.playerId);
  if (!rosterEntries.length) {
    return safeReply(message, `${E.error} The player's team roster is inconsistent; no name was changed.`);
  }

  player.displayName = displayName;
  rosterEntries.forEach(entry => { entry.displayName = displayName; });
  if (team.captainUserId === userId) team.captainName = displayName;
  await team.save();
  await player.save();
  return safeReply(message, `${E.success} Updated <@${userId}>'s SCL display name to **${displayName}** on **${team.name}**.`);
}

async function setTeamRole(message, args, config, Team) {
  if (!await requireRef(message, config)) return;

  const mentionedRoleId = message.mentions?.roles?.first()?.id || '';
  const roleId = mentionedRoleId || args.map(cleanId).find(value => /^\d{15,25}$/.test(value)) || '';
  const clear = !roleId && ['clear', 'none'].includes(key(args[args.length - 1]));

  const teamName = args
    .filter((arg, index) => !/<@&\d+>/.test(arg)
      && cleanId(arg) !== roleId
      && !(clear && index === args.length - 1))
    .join(' ')
    .trim();
  if (!teamName || (!roleId && !clear)) {
    return safeReply(message, `${E.warning} Usage: \`.sclsetteamrole Team Name @role\` or \`.sclsetteamrole Team Name clear\`.`);
  }

  const guildId = message.guild.id;
  const team = await Team.findOne({ guildId, nameKey: key(teamName) });
  if (!team) return safeReply(message, `${E.error} Approved SCL team **${teamName}** not found. Use the exact team name from \`.sclteams\`.`);

  if (clear) {
    team.roleId = '';
    await team.save();
    return safeReply(message, `${E.success} Cleared the Discord role for **${team.name}**.`);
  }

  const role = message.guild.roles.cache.get(roleId)
    || await message.guild.roles.fetch(roleId).catch(() => null);
  if (!role || role.id === message.guild.id) return safeReply(message, `${E.error} That role was not found in this server.`);

  const existingTeam = await Team.findOne({ guildId, roleId, teamId: { $ne: team.teamId } }).select('name').lean();
  if (existingTeam) return safeReply(message, `${E.error} <@&${roleId}> is already linked to **${existingTeam.name}**.`);

  team.roleId = roleId;
  await team.save();
  return safeReply(message, `${E.success} Linked <@&${roleId}> to **${team.name}**. Run \`.sclsyncroles\` to apply it to the roster.`);
}

function buildTeamRoleSyncPlan(teams) {
  const mappedTeams = teams.filter(team => team.roleId);
  const roleIds = new Set(mappedTeams.map(team => team.roleId));
  if (roleIds.size !== mappedTeams.length) {
    throw new Error('A Discord role is linked to more than one SCL team.');
  }

  const expectedRoleByUser = new Map();
  for (const team of mappedTeams) {
    for (const player of team.roster || []) {
      if (!player.userId) continue;
      const currentRoleId = expectedRoleByUser.get(player.userId);
      if (currentRoleId && currentRoleId !== team.roleId) {
        throw new Error(`Player ${player.userId} is listed on multiple SCL team rosters.`);
      }
      expectedRoleByUser.set(player.userId, team.roleId);
    }
  }

  return { roleIds, expectedRoleByUser };
}

async function syncTeamRoles(message, config, Team) {
  if (!await requireRef(message, config)) return;

  const teams = await Team.find({ guildId: message.guild.id })
    .select('name teamId roster roleId')
    .lean();
  let plan;
  try {
    plan = buildTeamRoleSyncPlan(teams);
  } catch (error) {
    return safeReply(message, `${E.error} ${error.message} Fix the team role links or rosters before syncing.`);
  }
  if (!plan.roleIds.size) {
    return safeReply(message, `${E.warning} No SCL team roles are linked yet. Use \`.sclsetteamrole <team name> @role\` first.`);
  }

  for (const roleId of plan.roleIds) {
    const role = message.guild.roles.cache.get(roleId)
      || await message.guild.roles.fetch(roleId).catch(() => null);
    if (!role || role.id === message.guild.id) {
      return safeReply(message, `${E.error} Linked role \`${roleId}\` no longer exists. Update that team with \`.sclsetteamrole\` before syncing.`);
    }
    if (!role.editable) {
      return safeReply(message, `${E.error} I cannot manage <@&${roleId}>. Move my bot role above it and check the Manage Roles permission.`);
    }
  }

  let members;
  try {
    members = await message.guild.members.fetch();
  } catch (error) {
    console.error('SCL role sync member fetch failed:', error);
    return safeReply(message, `${E.error} I could not load this server’s members, so no SCL roles were changed.`);
  }

  const summary = { added: 0, removed: 0, missingMembers: 0, failed: 0 };
  for (const userId of plan.expectedRoleByUser.keys()) {
    if (!members.has(userId)) summary.missingMembers += 1;
  }

  for (const member of members.values()) {
    const expectedRoleId = plan.expectedRoleByUser.get(member.id);
    for (const roleId of plan.roleIds) {
      if (roleId === expectedRoleId || !member.roles.cache.has(roleId)) continue;
      try {
        await member.roles.remove(roleId, 'SCL team role sync');
        summary.removed += 1;
      } catch (error) {
        summary.failed += 1;
        console.error(`SCL role sync could not remove role ${roleId} from ${member.id}:`, error);
      }
    }
    if (expectedRoleId && !member.roles.cache.has(expectedRoleId)) {
      try {
        await member.roles.add(expectedRoleId, 'SCL team role sync');
        summary.added += 1;
      } catch (error) {
        summary.failed += 1;
        console.error(`SCL role sync could not add role ${expectedRoleId} to ${member.id}:`, error);
      }
    }
  }

  return safeReply(message, [
    `${E.success} SCL team role sync complete.`,
    `Added: **${summary.added}**  •  Removed: **${summary.removed}**`,
    `Roster members not found: **${summary.missingMembers}**  •  Failed updates: **${summary.failed}**`
  ].join('\n'));
}

async function toggle(message, args, config) {
  if (!isOwner(message)) return safeReply(message, `${E.error} Only the bot owner or server owner can enable or disable SCL commands.`);
  const requested = key(args.shift()); const command = commandGroup(requested); const state = key(args.shift());
  if (!command || !['on', 'off', 'enable', 'disable'].includes(state)) return safeReply(message, `${E.warning} Usage: \`.scltoggle <command|all> on|off\` (examples: \`profile\`, \`team\`, \`points\`).`);
  const enabled = ['on', 'enable'].includes(state);
  if (command === 'all') { config.enabled = enabled; await config.save(); return safeReply(message, `${E.success} All SCL commands are now **${enabled ? 'enabled' : 'disabled'}**.`); }
  if (CONTROL_ACTIONS.has(command)) return safeReply(message, `${E.error} Setup, status, help, and toggle cannot be disabled.`);
  config.disabledCommands = enabled ? config.disabledCommands.filter(item => item !== command) : [...new Set([...config.disabledCommands, command])]; await config.save();
  return safeReply(message, `${E.success} SCL command group **${command}** is now **${enabled ? 'enabled' : 'disabled'}**.`);
}

async function run(message, rawArgs, client, invokedName) {
    if (!message.guild) return safeReply(message, `${E.error} SCL commands can only be used in a server.`);
    const { Config, Player, Team, PendingTeam } = await models();
    const config = await getConfig(Config, message.guild.id);
    const { action: suppliedAction, args } = route(message, [...rawArgs], invokedName);
    const actionAliases = {
      create: 'teamcreate',
      createteam: 'teamcreate',
      teams: 'teams',
      individual: 'individuals',
      table: 'standings',
      ctn: 'changeteamname',
      sclsetnick: 'setplayername',
      sclnetnick: 'setplayername'
    };
    const action = actionAliases[suppliedAction] || suppliedAction;
    if (disabled(config, action)) return safeReply(message, `${E.locked} That SCL command group is currently disabled by the bot owner.`);
    const modelSet = { Config, Player, Team, PendingTeam };
    if (action === 'help') return safeReply(message, { embeds: [helpPayload(process.env.PREFIX || '.')] });
    if (action === 'status') return setup(message, ['status'], config);
    if (action === 'setup') return setup(message, args, config);
    if (action === 'toggle') return toggle(message, args, config);
    if (action === 'registration') return registration(message, args, config);
    if (action === 'changeteamname') return changeTeamName(message, args, config, Team, PendingTeam);
    if (action === 'setplayername') return setPlayerName(message, args, config, Player, Team);
    if (action === 'setteamrole') return setTeamRole(message, args, config, Team);
    if (action === 'syncroles') return syncTeamRoles(message, config, Team);
    if (action === 'profile') return profiles(message, args, Player, Team);
    if (action === 'myteam') return myTeam(message, Team);
    if (action === 'teamcreate') return teamCommand(message, args, config, modelSet, true);
    if (action === 'team') return teamCommand(message, args, config, modelSet);
    if (action === 'teams') return teamCommand(message, [], config, modelSet);
    if (action === 'approve') return approveRequest(message, args, config, modelSet);
    if (action === 'reject') return approveRequest(message, args, config, modelSet, true);
    if (action === 'points') return givePoints(message, args, config, modelSet);
    if (action === 'standings') return tables(message, modelSet);
    if (action === 'individuals') return tables(message, modelSet, true);
    return safeReply(message, { embeds: [helpPayload(process.env.PREFIX || '.')] });
}

module.exports = {
  name: 'scl',
  aliases: [],
  usesHFTournamentContext: false,
  buildTeamRoleSyncPlan,
  changeTeamName,
  formatTeamRoster,
  myTeam,
  setPlayerName,
  requestedPlayerName,
  syncTeamRoles,
  safeReply,
  execute: run,
  run
};
