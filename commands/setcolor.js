const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getData, updateData } = require('../utils/sheets');
const { invalidateSheetCache, sendAuditLog } = require('../utils/helpers');
const E = require('../utils/emojis');

const COLOR_PRESETS = {
  red: '#E74C3C',
  blue: '#3498DB',
  green: '#2ECC71',
  yellow: '#F1C40F',
  orange: '#E67E22',
  purple: '#9B59B6',
  pink: '#FF69B4',
  black: '#2F3136',
  white: '#FFFFFF',
  gold: '#FFD700',
  cyan: '#00FFFF',
  grey: '#95A5A6',
  gray: '#95A5A6'
};

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function cleanId(value) {
  return String(value || '').replace(/[<@!>]/g, '').trim();
}

function parseColor(input) {
  const raw = String(input || '').trim();
  const key = normalize(raw);

  if (COLOR_PRESETS[key]) return COLOR_PRESETS[key];

  const hex = raw.startsWith('#') ? raw : `#${raw}`;
  if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
    return hex.toUpperCase();
  }

  return null;
}

function hexToInt(hex) {
  return parseInt(String(hex || '').replace('#', ''), 16);
}

function buildPresetList(limit = 8) {
  return Object.keys(COLOR_PRESETS)
    .slice(0, limit)
    .map(name => `\`${name}\``)
    .join(', ');
}

function buildColorSummary(teamRow, captainId, color, previousColor) {
  return {
    teamName: String(teamRow?.[0] || 'Unknown Team'),
    shortName: String(teamRow?.[2] || 'N/A'),
    captainId,
    color,
    previousColor: previousColor || 'Not set'
  };
}

function buildColorDescription(summary) {
  return (
    `${safeEmoji(E.blueIcon, '🔵')} **Team:** ${summary.teamName} • **${summary.shortName}**\n` +
    `${safeEmoji(E.mvp, '👑')} **Captain:** <@${summary.captainId}>\n` +
    `${safeEmoji(E.up, '🎨')} **New Color:** ${summary.color}\n` +
    `${safeEmoji(E.Stats, '📊')} **Previous Color:** ${summary.previousColor}\n\n` +
    `This color is now saved and will be used for your team embeds where supported.`
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setcolor')
    .setDescription('Captain: set your coop team embed color')
    .addStringOption(opt =>
      opt
        .setName('color')
        .setDescription('Color name or hex code, example: blue or #5865F2')
        .setRequired(true)
    ),

  async execute(interaction) {
    const input = interaction.options.getString('color');
    const color = parseColor(input);

    if (!color) {
      return {
        embeds: [
          new EmbedBuilder()
            .setTitle(`${safeEmoji(E.wrong, '❌')} Invalid Color`)
            .setDescription(
              `Use a preset color like ${buildPresetList()}.\n\n` +
              `You can also use a hex code like \`#5865F2\`.\n` +
              `Example: \`/setcolor color:blue\``
            )
            .setColor(0xE74C3C)
            .setFooter({ text: 'Set Color • Use a preset name or valid hex code' })
        ]
      };
    }

    const captainId = interaction.user.id;
    const sheet = await getData('Teams!A:H');
    const rows = Array.isArray(sheet) ? sheet.slice(1).map(r => [...r]) : [];

    const teamIndex = rows.findIndex(row => cleanId(row[4]) === captainId);

    if (teamIndex === -1) {
      return {
        content: `${safeEmoji(E.lock, '🚫')} Only a registered coop team captain can use this command.`
      };
    }

    const team = rows[teamIndex];
    while (team.length < 8) team.push('');

    const previousColor = String(team[7] || '').trim();
    team[7] = color;
    rows[teamIndex] = team;

    await updateData('Teams!A2:H', rows);

    invalidateSheetCache([
      'Teams!',
      'Teams!A:G',
      'Teams!A:H'
    ]);

    const summary = buildColorSummary(team, captainId, color, previousColor);

    sendAuditLog(interaction, {
      title: '🎨 Team Color Updated',
      description: `Color updated for **${summary.teamName}**.`,
      color: hexToInt(color),
      fields: [
        { name: '🔤 Short Name', value: summary.shortName, inline: true },
        { name: '👑 Captain', value: `<@${captainId}>`, inline: true },
        { name: '🎨 New Color', value: color, inline: true },
        { name: '📊 Previous Color', value: previousColor || 'Not set', inline: true }
      ]
    });

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle(`${safeEmoji(E.correct, '✅')} Team Color Updated`)
          .setDescription(buildColorDescription(summary))
          .addFields(
            { name: '🎨 Saved Color', value: color, inline: true },
            { name: '📊 Previous', value: previousColor || 'Not set', inline: true },
            { name: '🔤 Short Name', value: summary.shortName, inline: true }
          )
          .setColor(hexToInt(color))
          .setFooter({ text: 'Set Color • SiuuVerse Coop Team Settings' })
      ]
    };
  }
};