const { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder } = require('discord.js');
const E = require('../utils/emojis');

const CATEGORIES = {
  overview: {
    label: 'Overview',
    description: 'Core HF Mongo tournament commands.',
    commands: [
      '`+hfhelp` - Open this command guide',
      '`+hfprofile [@user]` - View tournament and all-time player stats'
    ]
  },
  tournament: {
    label: 'Tournament Management',
    description: 'Create and control the one open tournament in this server.',
    commands: [
      '`+hftournament create` - Interactive league, cup, or groups/knockout setup',
      '`+hfadvance <id> [round]` - Advance Mongo cup or knockout fixtures',
      '`+hftournament end <id>` - End the open tournament',
      '`+hftournament cleanup <id>` - Remove fixtures and standings but preserve player stats',
      '`+hftournament reset <id>` - Reset fixtures and stats for a tournament',
      '`+hftournament registration on|off` - Open or close registration for the current tournament'
    ]
  },
  access: {
    label: 'Access and Roles',
    description: 'Bot-owner access and tournament role/channel settings.',
    commands: [
      '`+hftournament grant @user admin|mod` - Grant server access (owner only)',
      '`+hftournament configure <id> stats #channel` - Set stats log channel',
      '`+hftournament configure <id> result #channel` - Set result log channel',
      '`+hftournament configure <id> reserve #channel` - Set reserve log channel',
      '`+hftournament configure <id> player|captain|vicecaptain|lock @role` - Set roles'
    ]
  },
  registration: {
    label: 'Registration',
    description: 'Manage teams and tournament players without a sheet.',
    commands: [
      '`+hftournament team <id> add <team name>` - Add a team',
      '`+hftournament team <id> player <team name> @user` - Add a player',
      '`+hftournament team <id> captain <team name> @user` - Set captain',
      '`+hftournament team <id> vicecaptain <team name> @user` - Set vice captain'
    ]
  },
  stats: {
    label: 'Stats and History',
    description: 'Stats are stored under the active Mongo tournament.',
    commands: [
      '`.as` - Record match stats in the active tournament',
      '`+hftournament linkstats <id> [@user]` - Link legacy Mongo stats',
      '`+hfprofile [@user]` - Switch between tournament, all-time, trophy, and award views'
    ]
  },
  awards: {
    label: 'Trophies and Awards',
    description: 'Permanent recognition managed by the bot owner.',
    commands: [
      '`+hftournament award <id> trophy <name> @user` - Add a trophy',
      '`+hftournament award <id> award <name> @user` - Add an award'
      , '`+hftournament penalty <id> -3 <team name>` - Remove or add team points'
    ]
  }
};

function buildPayload(category = 'overview') {
  const selected = CATEGORIES[category] || CATEGORIES.overview;
  const menu = new StringSelectMenuBuilder()
    .setCustomId('hfhelp_category')
    .setPlaceholder('Choose an HF help category')
    .addOptions(Object.entries(CATEGORIES).map(([value, item]) => ({
      label: item.label,
      value,
      description: item.description.slice(0, 100),
      default: value === category
    })));
  const embed = new EmbedBuilder()
    .setTitle(`${E.Stats || '📊'} HandFootball Mongo Help`)
    .setDescription(`${selected.description}\n\n${selected.commands.join('\n')}`)
    .setColor(0xF1C40F)
    .setFooter({ text: 'One open tournament per server • Fixtures remain sheet-backed' });
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

module.exports = {
  name: 'hfhelp',
  aliases: ['hfcommands', 'help-hf'],
  usesHFTournamentContext: false,
  async execute(message) {
    return message.reply(buildPayload());
  },
  async selectHandler(interaction) {
    return buildPayload(interaction.values?.[0]);
  }
};
