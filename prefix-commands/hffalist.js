const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const E = require('../utils/emojis');
const {
  cleanId,
  mentionUser,
  truncateField
} = require('../utils/handfootball');

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function getConfiguredRoleIds() {
  return Array.from(new Set([
    ...String(process.env.HF_FREE_AGENT_ROLE_ID || '').split(','),
    ...String(process.env.HF_FREE_AGENT_ROLE_IDS || '').split(',')
  ].map(cleanId).filter(Boolean)));
}

async function resolveRoleNames(guild, roleIds) {
  const roles = await Promise.all(roleIds.map(async roleId => {
    return guild.roles.cache.get(roleId)
      || await guild.roles.fetch(roleId).catch(() => null);
  }));

  return roles.filter(Boolean);
}

function sortMembers(left, right) {
  return (
    left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' }) ||
    left.user.username.localeCompare(right.user.username, undefined, { sensitivity: 'base' })
  );
}

function buildMemberLines(members, startIndex) {
  return members.map((member, index) => {
    const lineNumber = startIndex + index + 1;

    return [
      `\`${lineNumber}.\` **${member.displayName}**`,
      `${member.user.username} • ${mentionUser(member.id)}`
    ].join('\n');
  }).join('\n\n');
}

module.exports = {
  name: 'hffalist',
  aliases: ['hffa'],

  async execute(message) {
    if (!message.guild) {
      return message.reply(`${E.warning} This command can only be used in a server.`);
    }

    const roleIds = getConfiguredRoleIds();

    if (!roleIds.length) {
      return message.reply(
        `${E.missing} Add \`HF_FREE_AGENT_ROLE_ID\` (or \`HF_FREE_AGENT_ROLE_IDS\`) to your \`.env\` first.`
      );
    }

    const configuredRoles = await resolveRoleNames(message.guild, roleIds);
    const configuredRoleNames = configuredRoles.length
      ? configuredRoles.map(role => `\`${role.name}\``).join(', ')
      : roleIds.map(roleId => `\`${roleId}\``).join(', ');

    let usedFallback = false;
    let members = [];

    try {
      const allMembers = await message.guild.members.fetch();
      const freeAgentIds = new Set(roleIds);

      members = [...allMembers.values()]
        .filter(member => [...freeAgentIds].some(roleId => member.roles.cache.has(roleId)))
        .sort(sortMembers);
    } catch (error) {
      usedFallback = true;
      console.warn('⚠️ hffalist could not fetch all guild members, using cached members only.', error?.message || error);

      const freeAgentIds = new Set(roleIds);

      members = [...message.guild.members.cache.values()]
        .filter(member => [...freeAgentIds].some(roleId => member.roles.cache.has(roleId)))
        .sort(sortMembers);
    }

    if (!members.length) {
      return message.reply(`${E.warning} No users currently have the configured free agent role.`);
    }

    const PAGE_SIZE = 10;
    let page = 0;
    const totalPages = Math.ceil(members.length / PAGE_SIZE);

    const buildEmbed = (currentPage) => {
      const start = currentPage * PAGE_SIZE;
      const pageMembers = members.slice(start, start + PAGE_SIZE);
      const memberLines = buildMemberLines(pageMembers, start);

      return new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle(`${safeEmoji(E.team, 'Team')} HandFootball Free Agents`)
        .setDescription([
          `${safeEmoji(E.profile, '•')} **Available Users:** ${members.length}`,
          `${safeEmoji(E.league, '•')} Configured Role(s): ${configuredRoleNames}`,
          `${safeEmoji(E.trophy, '•')} These users currently have the free agent role.`,
          usedFallback ? `${safeEmoji(E.warning, '•')} Using cached members because a full guild fetch was unavailable.` : null
        ].filter(Boolean).join('\n'))
        .addFields({
          name: `${safeEmoji(E.profile, '•')} Free Agent Roster`,
          value: truncateField(memberLines || 'No Users Found')
        })
        .setFooter({
          text: `Page ${currentPage + 1}/${totalPages} • ${members.length} Free Agents${usedFallback ? ' • cached members' : ''}`
        })
        .setTimestamp();
    };

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('hffa_prev')
        .setEmoji(E.leftArrow.match(/\d+/)?.[0])
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('hffa_next')
        .setEmoji(E.rightArrow.match(/\d+/)?.[0])
        .setStyle(ButtonStyle.Secondary)
    );

    const sentMessage = await message.reply({
      embeds: [buildEmbed(page)],
      components: totalPages > 1 ? [row] : [],
      allowedMentions: { parse: [] }
    });

    if (totalPages <= 1) {
      return;
    }

    const collector = sentMessage.createMessageComponentCollector({
      time: 300000
    });

    collector.on('collect', async i => {
      if (i.user.id !== message.author.id) {
        return i.reply({
          content: '❌ Only the command user can use these buttons.',
          ephemeral: true
        });
      }

      if (i.customId === 'hffa_prev') {
        page = page <= 0 ? totalPages - 1 : page - 1;
      }

      if (i.customId === 'hffa_next') {
        page = page >= totalPages - 1 ? 0 : page + 1;
      }

      await i.update({
        embeds: [buildEmbed(page)],
        components: [row],
        allowedMentions: { parse: [] }
      });
    });
  }
};
