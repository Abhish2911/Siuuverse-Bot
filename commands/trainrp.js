const {
  SlashCommandBuilder,
  EmbedBuilder
} = require('discord.js');
const mongoose = require('mongoose');
const emojis = require('../utils/emojis');
const { getData, updateData } = require('../utils/sheets');

const TrainCooldown = mongoose.models.TrainCooldown || mongoose.model(
  'TrainCooldown',
  new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    lastTrain: { type: Date, default: null }
  })
);

const COOLDOWN_MS = 6 * 60 * 60 * 1000;

const ATTRIBUTE_COLUMNS = {
  'Shooting': 6,
  'Passing': 7,
  'Dexterity': 9,
  'Dribbling': 8,
  'Lower Body Strength': 10,
  'Aerial Strength': 11,
  'Defending': 12,
  'GK1': 13,
  'GK2': 14,
  'GK3': 15
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('trainrp')
    .setDescription('Train one RP attribute.')
    .addStringOption(option =>
      option
        .setName('attribute')
        .setDescription('Choose an attribute to train')
        .setRequired(true)
        .addChoices(
          { name: 'Shooting', value: 'Shooting' },
          { name: 'Passing', value: 'Passing' },
          { name: 'Dexterity', value: 'Dexterity' },
          { name: 'Dribbling', value: 'Dribbling' },
          { name: 'Lower Body Strength', value: 'Lower Body Strength' },
          { name: 'Aerial Strength', value: 'Aerial Strength' },
          { name: 'Defending', value: 'Defending' },
          { name: 'GK1', value: 'GK1' },
          { name: 'GK2', value: 'GK2' },
          { name: 'GK3', value: 'GK3' }
        )
    ),

  async execute(interaction) {
    const attribute = interaction.options.getString('attribute');

    const rows = await getData('Player_Data!A:P', {
      spreadsheetId: process.env.RP_SHEET_ID
    });

    const playerIndex = rows.findIndex(
      (row, index) => index > 0 && String(row[0] || '').trim() === interaction.user.id
    );

    if (playerIndex === -1) {
      return interaction.editReply({
        content: '❌ No RP player found.'
      });
    }

    const playerRow = [...rows[playerIndex]];
    const statColumn = ATTRIBUTE_COLUMNS[attribute];
    const currentValue = Number(playerRow[statColumn] || 0);
    const newValue = currentValue + 1;

    const cooldown = await TrainCooldown.findOne({
      userId: interaction.user.id
    });

    if (cooldown?.lastTrain) {
      const remaining = COOLDOWN_MS - (Date.now() - cooldown.lastTrain.getTime());

      if (remaining > 0) {
        const hours = Math.floor(remaining / 3600000);
        const minutes = Math.floor((remaining % 3600000) / 60000);

        return interaction.editReply({
          content: `⏳ You have already trained. Try again in ${hours}h ${minutes}m.`
        });
      }
    }

    playerRow[statColumn] = String(newValue);

    await updateData(
      `Player_Data!A${playerIndex + 1}:P${playerIndex + 1}`,
      [playerRow],
      { spreadsheetId: process.env.RP_SHEET_ID }
    );

    await TrainCooldown.findOneAndUpdate(
      { userId: interaction.user.id },
      { lastTrain: new Date() },
      { upsert: true }
    );

    const embed = new EmbedBuilder()
      .setTitle('🏋️ RP Training')
      .setDescription([
        `${emojis.correct} Training session completed.`,
        '',
        `${emojis.profile} Player: ${playerRow[1]}`,
        `${emojis.stats || emojis.Stats} Attribute: ${attribute}`,
        `${emojis.up} ${currentValue} → ${newValue}`,
        '',
        `${emojis.calendar} Cooldown: 6 Hours`
      ].join('\n'))
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
};
