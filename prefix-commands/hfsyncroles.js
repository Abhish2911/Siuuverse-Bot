const {
  findTeamMeta,
  getHFTournamentRoleId,
  isBotOwner,
  loadHandFootballData
} = require('../utils/handfootball');
const { EmbedBuilder } = require('discord.js');
const E = require('../utils/emojis');

module.exports = {
  name: 'hfsyncroles',
  aliases: ['syncroles', 'hfrolesync'],

  async execute(message) {
    if (!isBotOwner(message)) {
      return message.reply(`${E.wrong} Only the bot owner can sync HandFootball roles.`);
    }

    const data = await loadHandFootballData();
    const knownTeamRoleIds = new Set(data.teams.map(team => team.roleId).filter(Boolean));
    const tournamentRoleId = await getHFTournamentRoleId();
    const tournamentRole = tournamentRoleId
      ? message.guild.roles.cache.get(tournamentRoleId) || await message.guild.roles.fetch(tournamentRoleId).catch(() => null)
      : null;
    const summary = {
      processed: 0,
      added: 0,
      removed: 0,
      tournamentAdded: 0,
      tournamentRoleMissing: tournamentRoleId && !tournamentRole ? 1 : 0,
      noRole: 0,
      missingMember: 0,
      failed: 0
    };

    if (!knownTeamRoleIds.size && !tournamentRoleId) {
      return message.reply(`${E.missing} No team Role IDs or Tournament Role ID were found in the sheets.`);
    }

    const total = data.players.length;
    const progressMessage = await message.reply({
      embeds: [new EmbedBuilder()
        .setTitle(`${E.loading || '⏳'} HF Role Sync In Progress`)
        .setDescription(`${E.loading || '⏳'} Processing **0/${total}** players...`)
        .setTimestamp()]
    });
    let completed = 0;

    const updateProgress = async () => {
      await progressMessage.edit({
        embeds: [new EmbedBuilder()
          .setTitle(`${E.loading || '⏳'} HF Role Sync In Progress`)
          .setDescription([
            `${E.loading || '⏳'} Processed **${completed}/${total}** players`,
            `${E.correct} Added: **${summary.added}**  |  Removed: **${summary.removed}**`,
            `${E.trophy} Tournament roles added: **${summary.tournamentAdded}**`,
            `${E.missing} Missing members: **${summary.missingMember}**  |  Failed: **${summary.failed}**`
          ].join('\n'))
          .setTimestamp()]
      }).catch(() => null);
    };

    for (const player of data.players) {
      const team = findTeamMeta(data.teams, player.team);
      const targetRoleId = team.roleId;

      const member = await message.guild.members.fetch(player.userId).catch(() => null);
      if (!member) {
        summary.missingMember += 1;
        completed += 1;
        if (completed % 3 === 0 || completed === total) await updateProgress();
        continue;
      }

      summary.processed += 1;

      try {
        if (tournamentRole && !member.roles.cache.has(tournamentRoleId)) {
          await member.roles.add(tournamentRole, 'HandFootball role sync');
          summary.tournamentAdded += 1;
        }

        if (!targetRoleId) {
          summary.noRole += 1;
          completed += 1;
          if (completed % 3 === 0 || completed === total) await updateProgress();
          continue;
        }

        const targetRole = message.guild.roles.cache.get(targetRoleId) || await message.guild.roles.fetch(targetRoleId).catch(() => null);
        if (!targetRole) {
          summary.noRole += 1;
          completed += 1;
          if (completed % 3 === 0 || completed === total) await updateProgress();
          continue;
        }

        for (const roleId of knownTeamRoleIds) {
          if (roleId !== targetRoleId && member.roles.cache.has(roleId)) {
            await member.roles.remove(roleId, 'HandFootball role sync');
            summary.removed += 1;
          }
        }

        if (!member.roles.cache.has(targetRoleId)) {
          await member.roles.add(targetRoleId, 'HandFootball role sync');
          summary.added += 1;
        }
      } catch (error) {
        summary.failed += 1;
        console.error(`HF role sync failed for ${player.userId}:`, error);
      }

      completed += 1;
      if (completed % 3 === 0 || completed === total) await updateProgress();
    }

    return progressMessage.edit({
      embeds: [new EmbedBuilder().setTitle(`${E.correct} HF role sync complete`).setDescription([
        `${E.profile} Processed: **${summary.processed}**`,
        `${E.trophy} Tournament roles added: **${summary.tournamentAdded}**`,
        `${E.correct} Roles added: **${summary.added}**`,
        `${E.warning} Wrong roles removed: **${summary.removed}**`,
        `${E.missing} Missing role links: **${summary.noRole}**`,
        `${E.missing} Tournament role missing: **${summary.tournamentRoleMissing}**`,
        `${E.missing} Members not found: **${summary.missingMember}**`,
        `${E.wrong} Failed: **${summary.failed}**`
      ].join('\n')).setTimestamp()]
    });
  }
};
