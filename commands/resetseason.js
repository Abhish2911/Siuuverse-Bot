const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getData, updateData } = require('../utils/sheets');
const { invalidateSheetCache, sendAuditLog } = require('../utils/helpers');
const Suspension = require('../models/suspension');

function isOwner(interaction) {
  const ownerIds = String(process.env.OWNER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  return (
    ownerIds.includes(interaction.user.id) ||
    interaction.guild?.ownerId === interaction.user.id
  );
}

const clearFixtureResult = row => {
  const clean = [...row];
  while (clean.length < 10) clean.push('');
  clean[4] = '';
  clean[5] = '';
  clean[6] = '';
  if (clean.length > 9) clean[9] = 'Upcoming';
  return clean;
};

const makeBlankRow = (length) => Array.from({ length }, () => '');

async function clearMongoSuspensions(interaction) {
  if (!interaction?.guild?.id) return 0;

  try {
    const result = await Suspension.resetForGuild(interaction.guild.id, {
      deleteDocuments: true
    });

    return Number(result?.deletedCount || 0);
  } catch (error) {
    console.error('❌ Mongo suspension reset error:', error);
    return 0;
  }
}

function buildResetSeasonSummary(type, changed) {
  const resetLabel = type === 'results'
    ? 'Results only'
    : type === 'discipline'
      ? 'Discipline only'
      : 'Results + Discipline';

  return {
    type: resetLabel,
    changedCount: changed.length,
    firstChange: changed[0] || 'None',
    secondChange: changed[1] || 'None',
    thirdChange: changed[2] || 'None'
  };
}

function buildResetSeasonDescription(summary, mongoSuspensionDeleted) {
  return (
    `♻️ **Season Reset Complete**\n` +
    `Selected season data was cleared successfully from the active league sheets.\n\n` +
    `📌 **Reset Type:** ${summary.type}\n` +
    `✅ **Changed Items:** ${summary.changedCount}\n` +
    `1️⃣ **First Change:** ${summary.firstChange}\n` +
    `2️⃣ **Second Change:** ${summary.secondChange}\n` +
    `3️⃣ **Third Change:** ${summary.thirdChange}\n` +
    `🗄️ **Mongo Suspensions Deleted:** ${mongoSuspensionDeleted}`
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resetseason')
    .setDescription('Reset season data safely')
    .addStringOption(opt =>
      opt.setName('type')
        .setDescription('What should be reset?')
        .setRequired(true)
        .addChoices(
          { name: 'Results only', value: 'results' },
          { name: 'Discipline only', value: 'discipline' },
          { name: 'Results + Discipline', value: 'all' }
        )
    )
    .addStringOption(opt =>
      opt.setName('confirm')
        .setDescription('Type CONFIRM to reset')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!isOwner(interaction)) {
      return { content: '🚫 Owner only command.' };
    }

    const type = interaction.options.getString('type');
    const confirm = interaction.options.getString('confirm');

    if (confirm !== 'CONFIRM') {
      return { content: '❌ Type `CONFIRM` exactly to reset season data.' };
    }

    const changed = [];
    let mongoSuspensionDeleted = 0;

    if (type === 'results' || type === 'all') {
      const fixtures = await getData('Fixtures!A:J');
      const fixtureRows = Array.isArray(fixtures) ? fixtures.slice(1).map(clearFixtureResult) : [];
      if (fixtureRows.length) {
        await updateData('Fixtures!A2:J', fixtureRows);
      }

      const matches = await getData('Matches_Entry!A:R');
      const blankMatches = Array.isArray(matches) ? matches.slice(1).map(() => makeBlankRow(18)) : [];
      if (blankMatches.length) {
        await updateData('Matches_Entry!A2:R', blankMatches);
      }

      const reserve = await getData('Reserve!A:D').catch(() => []);
      const blankReserve = Array.isArray(reserve) ? reserve.slice(1).map(() => makeBlankRow(4)) : [];
      if (blankReserve.length) {
        await updateData('Reserve!A2:D', blankReserve);
      }

      changed.push(
        'Fixtures scores/results/status cleared',
        'Matches_Entry cleared',
        'Reserve sheet cleared'
      );
    }

    if (type === 'discipline' || type === 'all') {
      const suspension = await getData('Suspension!A:G').catch(() => []);
      const blankSuspension = Array.isArray(suspension) ? suspension.slice(1).map(() => makeBlankRow(7)) : [];
      if (blankSuspension.length) {
        await updateData('Suspension!A2:G', blankSuspension);
      }

      const fairPlay = await getData('Fair_Play!A:S').catch(() => []);
      const blankFairPlay = Array.isArray(fairPlay) ? fairPlay.slice(1).map(() => makeBlankRow(19)) : [];
      if (blankFairPlay.length) {
        await updateData('Fair_Play!A2:S', blankFairPlay);
      }

      mongoSuspensionDeleted = await clearMongoSuspensions(interaction);

      changed.push(
        'Suspension sheet cleared',
        'Fair Play sheet cleared',
        mongoSuspensionDeleted > 0
          ? `Mongo suspensions cleared (${mongoSuspensionDeleted})`
          : 'Mongo suspensions already empty'
      );
    }

    invalidateSheetCache([
      'Fixtures!',
      'Matches_Entry!',
      'Reserve!',
      'Ranking!',
      'Standings!',
      'Fair_Play!',
      'Suspension!',
      'Team_Stats!'
    ]);

    const summary = buildResetSeasonSummary(type, changed);

    sendAuditLog(interaction, {
      title: '♻️ Season Reset Used',
      description: `Season reset executed: **${summary.type}**`,
      color: 0xE67E22,
      fields: [
        { name: 'Changed', value: changed.join('\n') || 'None', inline: false },
        { name: 'Mongo Suspensions Deleted', value: String(mongoSuspensionDeleted), inline: true }
      ]
    });

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle('♻️ Season Reset Complete')
          .setDescription(buildResetSeasonDescription(summary, mongoSuspensionDeleted))
          .addFields(
            { name: '✅ Changed', value: changed.join('\n') || 'None', inline: false },
            { name: '📌 Reset Type', value: summary.type, inline: true },
            { name: '🧹 Total Cleared', value: String(summary.changedCount), inline: true },
            { name: '🗄️ Mongo Suspensions Deleted', value: String(mongoSuspensionDeleted), inline: true }
          )
          .setColor(0xE67E22)
          .setFooter({ text: 'Reset Season • Run /endseason before reset if you want to save the old season' })
      ]
    };
  }
};