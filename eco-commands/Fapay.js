const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { cachedGetData } = require('../utils/helpers');
const { updateData } = require('../utils/sheets');
const E = require('../utils/emojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('fapay')
    .setDescription('Pay rewards from the FA club to a player.')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('The user to pay')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('amount')
        .setDescription('Amount to pay (e.g. 50000, 50k, 2m)')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('reason')
        .setDescription('Reason for payment')
        .setRequired(false)
    ),
  async execute(interaction) {
    // Owner check
    const OWNER_IDS = (process.env.OWNER_IDS || '').split(',').map(x => x.trim()).filter(Boolean);
    if (!OWNER_IDS.includes(interaction.user.id)) {
      return interaction.reply({ content: '❌ Only bot owners can use this command.', ephemeral: true });
    }

    // Parse options
    const targetUser = interaction.options.getUser('user');
    const rawAmount = interaction.options.getString('amount');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    // Parse amount (support k/m suffixes)
    let amount;
    try {
      const amtStr = rawAmount.toLowerCase().replace(/,/g, '').trim();
      if (/^\d+(\.\d+)?k$/.test(amtStr)) {
        amount = Math.round(parseFloat(amtStr) * 1_000);
      } else if (/^\d+(\.\d+)?m$/.test(amtStr)) {
        amount = Math.round(parseFloat(amtStr) * 1_000_000);
      } else if (/^\d+(\.\d+)?$/.test(amtStr)) {
        amount = Math.round(parseFloat(amtStr));
      } else {
        throw new Error('Invalid amount format');
      }
    } catch (e) {
      return interaction.reply({ content: '❌ Invalid amount format. Use e.g. `50000`, `50k`, `2m`.', ephemeral: true });
    }
    if (amount <= 0) {
      return interaction.reply({ content: '❌ Amount must be greater than zero.', ephemeral: true });
    }

    // Get economy data
    const economySheet = 'Economy';
    const economyData = await cachedGetData(economySheet);

    // Find player row by UserID in column B (index 1)
    const playerRowIndex = economyData.findIndex(row => String(row[1]).trim() === targetUser.id);
    if (playerRowIndex === -1) {
      return interaction.reply({ content: `${E.error} Could not find that player in the database.`, ephemeral: true });
    }
    const playerRow = economyData[playerRowIndex];

    // Find FA row by Club Name 'The FA' in column A (index 0) OR UserID '844445906845433906' in column B (index 1)
    const faRowIndex = economyData.findIndex(row =>
      String(row[0]).trim() === 'The FA' ||
      String(row[1]).trim() === '844445906845433906'
    );
    if (faRowIndex === -1) {
      return interaction.reply({ content: `${E.error} Could not find the FA club in the database.`, ephemeral: true });
    }
    const faClubRow = economyData[faRowIndex];

    // Check FA balance (column D, index 3)
    let faBalance = Number(faClubRow[3] || 0);
    if (isNaN(faBalance)) faBalance = 0;
    if (faBalance < amount) {
      return interaction.reply({ content: `${E.error} The FA club does not have enough balance for this payment.`, ephemeral: true });
    }

    // Update balances (column D, index 3)
    const newFaBalance = faBalance - amount;
    let playerBalance = Number(playerRow[3] || 0);
    if (isNaN(playerBalance)) playerBalance = 0;
    const newPlayerBalance = playerBalance + amount;

    faClubRow[3] = newFaBalance;
    playerRow[3] = newPlayerBalance;

    // Save economy sheet once
    await updateData(economySheet, 'A2:D', economyData);

    // Format numbers with commas
    const formatNum = n => n.toLocaleString('en-US');

    // Reply with success embed
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`${E.success} FA Payment Complete`)
      .setDescription(`${E.trophy} Funds transferred from **The FA**.`)
      .addFields(
        {
          name: 'Recipient',
          value: `${targetUser}\n**${playerRow[2]}**`,
          inline: true
        },
        {
          name: 'Amount',
          value: `**$${formatNum(amount)}**`,
          inline: true
        },
        {
          name: 'Reason',
          value: reason,
          inline: false
        },
        {
          name: 'Remaining FA Balance',
          value: `$${formatNum(newFaBalance)}`,
          inline: false
        }
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }
};