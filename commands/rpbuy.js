const {
  SlashCommandBuilder,
  EmbedBuilder
} = require('discord.js');

const { cachedGetData } = require('../utils/helpers');
const { getData, updateData } = require('../utils/sheets');
const E = require('../utils/emojis');

const RPShopPurchase = require('../models/RPShopPurchase');

const TEN_DAYS = 10 * 24 * 60 * 60 * 1000;

const OVR_REQUIREMENTS = {
  75: 0,76: 5,77: 10,78: 15,79: 20,80: 30,81: 40,82: 50,83: 60,84: 70,
  85: 85,86: 100,87: 115,88: 130,89: 145,90: 165,91: 185,92: 205,
  93: 225,94: 245,95: 270,96: 300,97: 330,98: 360,99: 400
};

const MARKET_VALUES = {
  75:'500k',76:'650k',77:'800k',78:'1M',79:'1.3M',80:'1.7M',
  81:'2.2M',82:'2.8M',83:'3.5M',84:'4.5M',85:'6M',86:'8M',
  87:'11M',88:'15M',89:'20M',90:'27M',91:'35M',92:'45M',
  93:'60M',94:'80M',95:'110M',96:'150M',97:'200M',
  98:'275M',99:'400M'
};

const ATTRIBUTE_COLUMNS = {
  'Shooting': 6,
  'Passing': 7,
  'Dribbling': 8,
  'Dexterity': 9,
  'Lower Body Strength': 10,
  'Aerial Strength': 11,
  'Defending': 12,
  'GK1': 13,
  'GK2': 14,
  'GK3': 15
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rpbuy')
    .setDescription('Purchase Training Points from the RP Shop.')
    .addIntegerOption(option =>
      option
        .setName('amount')
        .setDescription('How many Training Points would you like to buy?')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    )
    .addStringOption(option =>
      option
        .setName('attribute')
        .setDescription('Attribute to increase')
        .setRequired(true)
        .addChoices(
          { name: 'Shooting', value: 'Shooting' },
          { name: 'Passing', value: 'Passing' },
          { name: 'Dribbling', value: 'Dribbling' },
          { name: 'Dexterity', value: 'Dexterity' },
          { name: 'Lower Body Strength', value: 'Lower Body Strength' },
          { name: 'Aerial Strength', value: 'Aerial Strength' },
          { name: 'Defending', value: 'Defending' },
          { name: 'GK1', value: 'GK1' },
          { name: 'GK2', value: 'GK2' },
          { name: 'GK3', value: 'GK3' }
        )
    ),

  async execute(interaction) {

    const amount = interaction.options.getInteger('amount');
    const attribute = interaction.options.getString('attribute');

    let purchase = await RPShopPurchase.findOne({
      userId: interaction.user.id
    });

    if (!purchase) {
      purchase = await RPShopPurchase.create({
        userId: interaction.user.id
      });
    }

    if (Date.now() >= purchase.resetAt.getTime()) {
      purchase.purchases = 0;
      purchase.resetAt = new Date(Date.now() + TEN_DAYS);
    }

    if (purchase.purchases + amount > 5) {
      const reset = Math.floor(purchase.resetAt.getTime() / 1000);

      return interaction.editReply({
        content:
          `${E.error} You can only purchase **5 Training Points per season**.\n` +
          `Already purchased: **${purchase.purchases}/5**\n` +
          `You can buy again <t:${reset}:R>.`
      });
    }

    const playerRows = await getData('Player_Data!A:R', {
      spreadsheetId: process.env.RP_SHEET_ID
    });

    // Economy
    const economyData = await cachedGetData('Economy!A:D', {
      spreadsheetId: process.env.RP_SHEET_ID
    });

    const economy = economyData.slice(1);

    const economyIndex = economy.findIndex(
      row => String(row[1] || '').trim() === interaction.user.id
    );

    if (economyIndex === -1) {
      return interaction.editReply({
        content: `${E.error} Economy profile not found.`
      });
    }

    const economyRow = [...economy[economyIndex]];
    const balance = Number(String(economyRow[3] || '0').replace(/,/g, '')) || 0;

    const playerIndex = playerRows.findIndex(
      (row, i) =>
        i > 0 &&
        String(row[0] || '').trim() === interaction.user.id
    );

    if (playerIndex === -1) {
      return interaction.editReply({
        content: `${E.error} No RP player found.`
      });
    }

    const playerRow = [...playerRows[playerIndex]];

    const ovr = Number(playerRow[2] || 75);

    let PRICE;
    if (ovr <= 79) PRICE = 150000;
    else if (ovr <= 84) PRICE = 200000;
    else if (ovr <= 89) PRICE = 300000;
    else if (ovr <= 94) PRICE = 400000;
    else PRICE = 500000;

    const totalCost = PRICE * amount;

    if (balance < totalCost) {
      return interaction.editReply({
        content: `${E.error} You need **${totalCost.toLocaleString()} SiuuCoins** but only have **${balance.toLocaleString()} SiuuCoins**.`
      });
    }

    if (!ATTRIBUTE_COLUMNS[attribute]) {
      return interaction.editReply({
        content: `${E.error} Invalid attribute selected.`
      });
    }

    // Deduct money
    await updateData(
      `Economy!D${economyIndex + 2}`,
      [[balance - totalCost]],
      {
        spreadsheetId: process.env.RP_SHEET_ID
      }
    );

    const sheetRow = playerIndex + 1;

    // Increase attribute
    const col = ATTRIBUTE_COLUMNS[attribute];
    const current = Number(playerRow[col] || 0);

    await updateData(
      `Player_Data!${String.fromCharCode(65 + col)}${sheetRow}`,
      [[current + amount]],
      {
        spreadsheetId: process.env.RP_SHEET_ID
      }
    );

    purchase.purchases += amount;
    await purchase.save();

    // Check OVR
    const totalTP = Number(playerRow[16] || 0) + amount;
    const oldOVR = Number(playerRow[2] || 75);

    let newOVR = oldOVR;

    for (const [ovr, required] of Object.entries(OVR_REQUIREMENTS)) {
      if (totalTP >= required) {
        newOVR = Number(ovr);
      }
    }

    if (newOVR > oldOVR) {
      await updateData(
        `Player_Data!C${sheetRow}:D${sheetRow}`,
        [[newOVR, MARKET_VALUES[newOVR]]],
        {
          spreadsheetId: process.env.RP_SHEET_ID
        }
      );
    }

    const embed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setTitle('🛒 RP Shop')
      .setDescription(
        [
          `${E.correct} Successfully purchased **${amount} Training Point${amount > 1 ? 's' : ''}**.`,
          `${E.Stats} Attribute: **${attribute}**`,
          '',
          `${E.money || '💰'} Spent: **${totalCost.toLocaleString()} SiuuCoins**`,
          `${E.rank} Season Limit: **${purchase.purchases}/5 TP Used**`,
          `${E.fire} Remaining Balance: **${(balance - totalCost).toLocaleString()} SiuuCoins**`
        ].join('\n')
      )
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed]
    });

  }
};