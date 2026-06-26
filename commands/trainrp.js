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

const OVR_REQUIREMENTS = {
  75: 0,76: 5,77: 10,78: 15,79: 20,80: 30,81: 40,82: 50,83: 60,84: 70,85: 85,86: 100,87: 115,88: 130,89: 145,90: 165,91: 185,92: 205,93: 225,94: 245,95: 270,96: 300,97: 330,98: 360,99: 400
};
const MARKET_VALUES = {
  75:'500k',76:'650k',77:'800k',78:'1M',79:'1.3M',80:'1.7M',81:'2.2M',82:'2.8M',83:'3.5M',84:'4.5M',85:'6M',86:'8M',87:'11M',88:'15M',89:'20M',90:'27M',91:'35M',92:'45M',93:'60M',94:'80M',95:'110M',96:'150M',97:'200M',98:'275M',99:'400M'
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

    const rows = await getData('Player_Data!A:Q', {
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

    const totalTPBefore = Number(playerRow[16] || 0); // Current Total TP from Q (before Sheets recalculates)
    const totalTP = totalTPBefore + 1;
    const oldOVR = Number(playerRow[2]);
    const oldMV = playerRow[3];
    let newOVR = 75;
    for (const [ovr, required] of Object.entries(OVR_REQUIREMENTS)) {
      if (totalTP >= required) {
        newOVR = Number(ovr);
      }
    }
    let levelUp = false;
    if (newOVR > oldOVR) {
      levelUp = true;
      playerRow[2] = String(newOVR);
      playerRow[3] = MARKET_VALUES[newOVR];
    }

    await updateData(
      `Player_Data!A${playerIndex + 1}:P${playerIndex + 1}`,
      [playerRow],
      { spreadsheetId: process.env.RP_SHEET_ID }
    );
    // Google Sheets now recalculates column Q automatically using the ARRAYFORMULA.

    await TrainCooldown.findOneAndUpdate(
      { userId: interaction.user.id },
      { lastTrain: new Date() },
      { upsert: true }
    );

    const lines = [
      `${emojis.correct} Training session completed.`,
      "",
      `${emojis.profile} Player: **${playerRow[1]}**`,
      `${emojis.stats} Trained: **${attribute}**`,
      `${emojis.up} ${currentValue} → ${newValue}`,
      "",
      `${emojis.Stats} Total TP: **${totalTP}**`
    ];
    if (levelUp) {
      lines.push(
        "",
        `${emojis.fire} **LEVEL UP!**`,
        `${emojis.rank} OVR: **${oldOVR} → ${newOVR}**`,
        `${emojis.trophy} Value: **${oldMV} → ${MARKET_VALUES[newOVR]}**`
      );
    }
    lines.push(
      "",
      `${emojis.calendar} Next Training: **6 Hours**`
    );
    const embed = new EmbedBuilder()
      .setColor(levelUp ? 0xFFD700 : 0x2ECC71)
      .setTitle("🏋️ RP Training")
      .setDescription(lines.join("\n"))
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
};
