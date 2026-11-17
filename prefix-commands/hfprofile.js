const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const TournamentStats = require('../models/TournamentStats');
const HFTournament = require('../models/HFTournament');
const HFTournamentAward = require('../models/HFTournamentAward');
const E = require('../utils/emojis');

const STAT_FIELDS = ['matches', 'goals', 'assists', 'mvps', 'hattricks', 'interceptions', 'tackles', 'saves'];

function targetUserId(interaction, args = []) {
  return interaction.mentions?.users?.first()?.id || args.join(' ').match(/\d{15,25}/)?.[0] || interaction.user.id;
}

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function addStats(target, source) {
  STAT_FIELDS.forEach(field => { target[field] += number(source?.[field]); });
  target.ratingMatches += number(source?.ratingMatches);
  target.trophies += number(source?.trophies);
  target.awards += number(source?.awards);
  if (number(source?.ratingAverage) && number(source?.ratingMatches)) {
    target.ratingTotal += number(source.ratingAverage) * number(source.ratingMatches);
  }
  return target;
}

function emptyStats() {
  return { ...Object.fromEntries([...STAT_FIELDS, 'ratingMatches', 'trophies', 'awards'].map(field => [field, 0])), ratingTotal: 0 };
}

async function getProfileData(guildId, userId) {
  const [tournaments, rows, awards] = await Promise.all([
    HFTournament.find({ guildId }).sort({ createdAt: -1 }).lean(),
    TournamentStats.find({ guildId, userId }).lean(),
    HFTournamentAward.find({ guildId, userId }).sort({ createdAt: -1 }).lean()
  ]);
  const usedTournamentIds = new Set([
    ...rows.map(row => row.tournamentId).filter(Boolean),
    ...awards.map(row => row.tournamentId).filter(Boolean)
  ]);
  const options = tournaments
    .filter(tournament => usedTournamentIds.has(tournament.tournamentId))
    .map(tournament => ({ id: tournament.tournamentId, name: tournament.name, type: tournament.type }));
  if (rows.some(row => !row.tournamentId)) options.push({ id: 'legacy', name: 'Legacy linked stats', type: 'legacy' });
  return { tournaments, rows, awards, options };
}

function selectRow(options, ownerId, targetUserId, selectedId) {
  if (!options.length) return null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`hfprofile_select_${ownerId}_${targetUserId}`)
    .setPlaceholder('Choose a tournament')
    .addOptions(options.slice(0, 25).map(option => ({
      label: option.name.slice(0, 100),
      value: option.id.slice(0, 100),
      description: option.type
    })));
  if (selectedId && menu.options?.length) {
    const selected = menu.options.find(option => option.data.value === selectedId);
    if (selected) selected.setDefault(true);
  }
  return new ActionRowBuilder().addComponents(menu);
}

function buttonRow(ownerId, targetUserId, tournamentId) {
  const encoded = encodeURIComponent(tournamentId || 'legacy');
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`hfprofile_current_${encoded}_${ownerId}_${targetUserId}`).setLabel('Current stats').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`hfprofile_alltime_${encoded}_${ownerId}_${targetUserId}`).setLabel('All-time stats').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`hfprofile_trophies_${encoded}_${ownerId}_${targetUserId}`).setLabel('Trophies').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`hfprofile_awards_${encoded}_${ownerId}_${targetUserId}`).setLabel('Awards').setStyle(ButtonStyle.Danger)
  );
}

function baseEmbed(user, description) {
  return new EmbedBuilder().setTitle(`${E.profile || '👤'} ${user.username}'s HF profile`).setDescription(description).setColor(0xF1C40F).setTimestamp();
}

async function render(interaction, userId, view = 'current', tournamentId = '') {
  const data = await getProfileData(interaction.guild.id, userId);
  const selected = data.options.find(option => option.id === tournamentId) || data.options[0];
  const selectedId = selected?.id || 'legacy';
  const ownerId = interaction.user?.id || interaction.author.id;
  const user = await interaction.client.users.fetch(userId).catch(() => interaction.user);
  const selectedRows = data.rows.filter(row => (selectedId === 'legacy' ? !row.tournamentId : row.tournamentId === selectedId));
  const current = selectedRows.reduce((accumulator, row) => addStats(accumulator, row), emptyStats());
  const total = data.rows.reduce((accumulator, row) => addStats(accumulator, row), emptyStats());
  const awards = data.awards.filter(row => selectedId === 'legacy' || row.tournamentId === selectedId);
  const trophyRows = awards.filter(row => row.kind === 'trophy');
  const awardRows = awards.filter(row => row.kind === 'award');
  const stats = view === 'alltime' ? total : current;
  let description = `**Tournament:** ${selected?.name || 'No tournament selected'}\n\n`;
  if (view === 'trophies') description += trophyRows.length ? trophyRows.map(row => `🏆 **${row.name}**`).join('\n') : 'No trophies recorded.';
  else if (view === 'awards') description += awardRows.length ? awardRows.map(row => `🏅 **${row.name}**`).join('\n') : 'No awards recorded.';
  else description += [
    `Matches: **${stats.matches}**`, `Goals: **${stats.goals}**`, `Assists: **${stats.assists}**`,
    `MVPs: **${stats.mvps}**`, `Hattricks: **${stats.hattricks}**`, `Interceptions: **${stats.interceptions}**`,
    `Tackles: **${stats.tackles}**`, `Saves: **${stats.saves}**`,
    `Rating: **${stats.ratingMatches >= 5 ? (stats.ratingTotal / stats.ratingMatches).toFixed(2) : 'Provisional (5 matches needed)'}**`
  ].join('\n');
  description += `\n\nTrophies: **${total.trophies + trophyRows.length}** • Awards: **${total.awards + awardRows.length}**`;
  const components = [selectRow(data.options, ownerId, userId, selectedId), buttonRow(ownerId, userId, selectedId)].filter(Boolean);
  return { embeds: [baseEmbed(user, description)], components };
}

module.exports = {
  name: 'hfprofile',
  aliases: ['myhfprofile', 'mystats'],
  usesHFTournamentContext: false,
  async execute(message, args, client) {
    if (!message.guild) return message.reply(`${E.wrong} This command can only be used in a server.`);
    return render({ guild: message.guild, client, user: message.author }, targetUserId(message, args), 'current');
  },
  async selectHandler(interaction) {
    const [, , ownerId, targetUserId] = interaction.customId.split('_');
    if (ownerId !== interaction.user.id) return null;
    return render(interaction, targetUserId, 'current', interaction.values[0]);
  },
  async buttonHandler(interaction) {
    const [, view, encodedId, ownerId, targetUserId] = interaction.customId.split('_');
    if (ownerId !== interaction.user.id) return { content: 'Only the user who opened this profile can use these controls.', components: [] };
    return render(interaction, targetUserId, view, decodeURIComponent(encodedId));
  }
};
