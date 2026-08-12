const {
  cleanId,
  findPlayerByUserId,
  findTeamByName,
  sameTeam,
  getFirstIdArg,
  getMentionedUserId,
  isBotOwner,
  isHFRegistrationOpen,
  loadHandFootballData,
  setHFCaptain,
  getHFCaptainRoleId,
  getHFTournamentRoleId,
  upsertHFTeamMeta,
  upsertHFPlayer
} = require('../utils/handfootball');
const E = require('../utils/emojis');

async function grantConfiguredRole(guild, userId, roleId, roleName) {

  if (!roleId) {
    return { configured: false };
  }

  try {
    const fetchedRoles = await guild.roles.fetch().catch(() => null);
    const role = guild.roles.cache.get(roleId)
      || fetchedRoles?.get?.(roleId)
      || await guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
      return {
        configured: true,
        assigned: false,
        reason: `the configured ${roleName} (ID: \`${roleId}\`) was not found in this server`
      };
    }

    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      return { configured: true, assigned: false, reason: 'the registered user is not in this server' };
    }

    if (!member.roles.cache.has(roleId)) {
      await member.roles.add(role, 'HandFootball registration');
    }

    return { configured: true, assigned: true };
  } catch (error) {
    console.error(`Failed to grant ${roleName} to ${userId}:`, error);
    return { configured: true, assigned: false, reason: `the ${roleName} could not be assigned` };
  }
}

async function replyAfterRegistration(message, content, userId, isCaptain = false) {
  const results = [
    await grantConfiguredRole(
      message.guild,
      userId,
      await getHFTournamentRoleId(),
      'tournament role'
    )
  ];

  if (isCaptain) {
    results.push(await grantConfiguredRole(
      message.guild,
      userId,
      getHFCaptainRoleId(),
      'HandFootball captain role'
    ));
  }

  const warnings = results
    .filter(result => result.configured && !result.assigned)
    .map(result => `${E.warning} Player registered, but ${result.reason}.`);

  return message.reply([content, ...warnings].join('\n'));
}

function parseRegisterArgs(message, args, captainPlayer) {
  const mentionedUserId = getMentionedUserId(message);
  const idArg = getFirstIdArg(args);
  const userId = mentionedUserId || idArg || message.author.id;
  let body = args.join(' ').replace(/<@!?\d+>/g, '').trim();

  if (idArg) {
    body = body.replace(new RegExp(`^${idArg}\\b`), '').trim();
  }

  const isCaptain = /\s--captain\b/i.test(` ${body}`);
  body = body.replace(/\s--captain\b/ig, '').trim();

  const separatorIndex = body.indexOf('|');
  const hasTeam = separatorIndex !== -1;

  return {
    userId: cleanId(userId),
    isCaptain,
    team: hasTeam ? body.slice(0, separatorIndex).trim() : captainPlayer?.team || '',
    player: hasTeam ? body.slice(separatorIndex + 1).trim() : body.trim()
  };
}

module.exports = {
  name: 'hfregister',
  aliases: ['hfreg', 'addhfplayer'],

  async execute(message, args) {
    const owner = isBotOwner(message);
    const registrationOpen = await isHFRegistrationOpen();

    if (!owner && !registrationOpen) {
      return message.reply(`${E.lock} HandFootball registration is currently closed.`);
    }

    const data = await loadHandFootballData();
    const captainPlayer = findPlayerByUserId(data.players, message.author.id);
    const parsed = parseRegisterArgs(message, args, captainPlayer);

    if (!parsed.team || !parsed.player || !parsed.userId) {
      return message.reply(`${E.profile} Usage: \`.hfregister Team Name | Your Player Name\` to create your team, or \`.addhfplayer @user Player Name\` after your team is registered.`);
    }

    const existingPlayer = findPlayerByUserId(data.players, parsed.userId);
    if (existingPlayer) {
      return message.reply(
        `${E.warning} <@${parsed.userId}> is already registered for **${existingPlayer.team}**. Remove them from that team before adding them to another team.`
      );
    }

    if (owner) {
      const isFirstTeamPlayer = !data.players.some(player => sameTeam(player.team, parsed.team));
      const shouldBeCaptain = parsed.isCaptain || isFirstTeamPlayer;

      await upsertHFTeamMeta(parsed.team, {});
      await upsertHFPlayer({
        ...parsed,
        isCaptain: shouldBeCaptain
      });

      if (shouldBeCaptain) {
        await setHFCaptain(parsed.team, parsed.userId);
      }

      return replyAfterRegistration(
        message,
        `${E.correct} Registered **${parsed.player}** for **${parsed.team}** as <@${parsed.userId}>${shouldBeCaptain ? ` and set captain ${E.captain}.` : '.'}`,
        parsed.userId,
        shouldBeCaptain
      );
    }

    if (captainPlayer?.isCaptain) {
      if (parsed.isCaptain) {
        return message.reply(`${E.wrong} Only the bot owner can register a player as captain.`);
      }

      if (!sameTeam(parsed.team, captainPlayer.team)) {
        return message.reply(`${E.warning} Captains can only register players for their own team.`);
      }

      await upsertHFPlayer({
        ...parsed,
        team: captainPlayer.team,
        isCaptain: false
      });

      return replyAfterRegistration(
        message,
        `${E.correct} Registered **${parsed.player}** for **${captainPlayer.team}** as <@${parsed.userId}>.`,
        parsed.userId
      );
    }

    const mentionedUserId = getMentionedUserId(message);
    const idArg = getFirstIdArg(args);

    if (mentionedUserId || idArg || parsed.userId !== message.author.id) {
      return message.reply(`${E.warning} First create your team with \`.hfregister Team Name | Your Player Name\`, then add players with \`.addhfplayer @user Player Name\`.`);
    }

    if (findTeamByName(data, parsed.team)) {
      return message.reply(`${E.warning} That HandFootball team already exists.`);
    }

    await upsertHFTeamMeta(parsed.team, {});
    await upsertHFPlayer({
      ...parsed,
      userId: message.author.id,
      isCaptain: true
    });
    await setHFCaptain(parsed.team, message.author.id);

    return replyAfterRegistration(
      message,
      `${E.correct} Registered **${parsed.team}** and set you as captain/player **${parsed.player}** ${E.captain}.`,
      message.author.id,
      true
    );
  }
};
