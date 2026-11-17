const { PermissionFlagsBits } = require('discord.js');
const mongoose = require('mongoose');
const ModerationAction = require('../models/ModerationAction');

function deferModerationReply(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    return interaction.deferReply();
  }
  return Promise.resolve();
}

function respondModerationReply(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply({ content, allowedMentions: { parse: [] } });
  }
  return interaction.reply({
    content,
    allowedMentions: { parse: [] }
  });
}

function assertMongoConnected() {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('Moderation storage is unavailable because MongoDB is not connected.');
  }
}

function requirePermissions(interaction, permission) {
  if (!interaction.memberPermissions?.has(permission)) {
    throw new Error(`You need the ${permissionName(permission)} permission to use this command.`);
  }
}

async function requireTargetBelowModerator(interaction, target, botMember) {
  if (target.id === interaction.guild.ownerId) {
    throw new Error('The server owner cannot be timed out.');
  }
  if (target.permissions.has(PermissionFlagsBits.Administrator)) {
    throw new Error('Members with Administrator permission cannot be timed out.');
  }

  if (interaction.user.id !== interaction.guild.ownerId) {
    const moderator = await interaction.guild.members.fetch(interaction.user.id);
    if (moderator.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
      throw new Error('Your highest role must be higher than the target member’s highest role.');
    }
  }

  if (botMember.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    throw new Error('My highest role must be higher than the target member’s highest role. Move my bot role above theirs in Server Settings → Roles.');
  }
}

function permissionName(permission) {
  const names = {
    [PermissionFlagsBits.ManageChannels]: 'Manage Channels',
    [PermissionFlagsBits.ModerateMembers]: 'Moderate Members',
    [PermissionFlagsBits.ManageMessages]: 'Manage Messages'
  };
  return names[permission] || 'required';
}

async function requireBotPermissions(interaction, permission) {
  const botMember = interaction.guild.members.me
    || await interaction.guild.members.fetchMe();
  if (!botMember.permissions.has(permission)) {
    throw new Error(`I need the ${permissionName(permission)} permission to do that.`);
  }
  return botMember;
}

async function recordAction(interaction, action, details = {}) {
  assertMongoConnected();
  await ModerationAction.create({
    guildId: interaction.guildId,
    action,
    moderatorId: interaction.user.id,
    targetId: details.targetId || '',
    channelId: details.channelId || '',
    reason: String(details.reason || '').slice(0, 1000),
    metadata: details.metadata || {}
  });
}

function formatAction(action) {
  return action.charAt(0).toUpperCase() + action.slice(1);
}

async function executeModerationPrefix(command, message, args, schema = {}) {
  const values = {};

  for (const [name, definition] of Object.entries(schema)) {
    const token = args[definition.index];

    if (definition.type === 'user') {
      if (!token) {
        values[name] = null;
        if (definition.required) throw new Error(`Usage: ${command.data.name} requires ${name}.`);
        continue;
      }

      const match = token.match(/^<@!?(\d+)>$/) || token.match(/^(\d+)$/);
      if (!match) throw new Error('Provide the member as a mention or user ID.');
      const member = await message.guild.members.fetch(match[1]).catch(() => null);
      if (!member) throw new Error('That member was not found in this server.');
      values[name] = member.user;
      continue;
    }

    if (definition.type === 'integer') {
      if (!token) {
        values[name] = null;
        if (definition.required) throw new Error(`A value is required for ${name}.`);
        continue;
      }

      const value = Number(token);
      if (!Number.isInteger(value) || value < definition.min || value > definition.max) {
        throw new Error(`${name} must be a whole number from ${definition.min} to ${definition.max}.`);
      }
      values[name] = value;
      continue;
    }

    if (definition.type === 'rest') {
      const value = args.slice(definition.index).join(' ').trim();
      if (definition.required && !value) throw new Error(`A value is required for ${name}.`);
      if (definition.maxLength && value.length > definition.maxLength) {
        throw new Error(`${name} must be ${definition.maxLength} characters or fewer.`);
      }
      values[name] = value || null;
    }
  }

  const interaction = {
    guild: message.guild,
    guildId: message.guild.id,
    channel: message.channel,
    channelId: message.channel.id,
    user: message.author,
    memberPermissions: message.member?.permissions,
    inGuild: () => Boolean(message.guild),
    deferReply: async () => {},
    reply: payload => message.channel.send(payload),
    editReply: payload => message.channel.send(payload),
    options: {
      getUser: (name, required = false) => required && !values[name]
        ? (() => { throw new Error(`A value is required for ${name}.`); })()
        : values[name] || null,
      getInteger: (name, required = false) => required && values[name] == null
        ? (() => { throw new Error(`A value is required for ${name}.`); })()
        : values[name] ?? null,
      getString: (name, required = false) => required && !values[name]
        ? (() => { throw new Error(`A value is required for ${name}.`); })()
        : values[name] || null
    }
  };

  return command.execute(interaction);
}

module.exports = {
  assertMongoConnected,
  deferModerationReply,
  executeModerationPrefix,
  formatAction,
  recordAction,
  requireBotPermissions,
  requirePermissions,
  requireTargetBelowModerator,
  respondModerationReply
};
