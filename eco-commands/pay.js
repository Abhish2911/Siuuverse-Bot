const {
  SlashCommandBuilder,
  EmbedBuilder
} = require('discord.js');

const { cachedGetData } = require('../utils/helpers');
const { updateData } = require('../utils/sheets');
const E = require('../utils/emojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pay')
    .setDescription('Transfer SiuuCoins to another user')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to pay')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('amount')
        .setDescription('Amount of SiuuCoins to transfer')
        .setRequired(true)
    ),

  async execute(interaction) {
    const target = interaction.options.getUser('user');

    const amountOption = interaction.options.get('amount');

    let amountInput;

    if (amountOption?.value !== undefined) {
      amountInput = String(amountOption.value).trim().toLowerCase();
    } else {
      amountInput = '0';
    }

    let amount;

    if (/^\d+(?:\.\d+)?k$/.test(amountInput)) {
      amount = Math.floor(parseFloat(amountInput) * 1_000);
    } else if (/^\d+(?:\.\d+)?m$/.test(amountInput)) {
      amount = Math.floor(parseFloat(amountInput) * 1_000_000);
    } else if (/^\d+(?:\.\d+)?e6$/.test(amountInput)) {
      amount = Math.floor(parseFloat(amountInput) * 1_000_000);
    } else if (/^\d+$/.test(amountInput)) {
      amount = parseInt(amountInput, 10);
    }

    if (!amount || amount < 1) {
      return {
        content: `${E.error} Invalid amount. Examples: **5000**, **300k**, **10m**, **10e6**`
      };
    }

    if (target.id === interaction.user.id) {
      return {
        content: `${E.error} You cannot pay yourself.`
      };
    }

    const economyData = await cachedGetData('Economy!A:D');
    const economy = economyData.slice(1); // skip header row

    const senderIndex = economy.findIndex(
      row => String(row[1] || '').trim() === interaction.user.id
    );

    const receiverIndex = economy.findIndex(
      row => String(row[1] || '').trim() === target.id
    );

    const senderClub = economy.find(
      row => String(row[1] || '').trim() === interaction.user.id
    );

    if (!senderClub) {
      return {
        content: `${E.error} Only club owners can make payments.`
      };
    }

    if (senderIndex === -1) {
      return {
        content: `${E.error} You don't have an economy account.`
      };
    }

    if (receiverIndex === -1) {
      return {
        content: `${E.error} That user doesn't have an economy account.`
      };
    }

    const senderBalance = Number(String(economy[senderIndex][3] || '0').replace(/,/g, '')) || 0;
    const receiverBalance = Number(String(economy[receiverIndex][3] || '0').replace(/,/g, '')) || 0;

    if (senderBalance < amount) {
      return {
        content: `${E.error} Insufficient SiuuCoins.\n\n${E.money || '💰'} Balance: **${senderBalance.toLocaleString()}**`
      };
    }

    const newSenderBalance = senderBalance - amount;
    const newReceiverBalance = receiverBalance + amount;

    const senderClubName = String(economy[senderIndex][0] || 'Unknown Club');
    const receiverClubName = String(economy[receiverIndex][0] || 'Unknown Club');

    const senderRow = senderIndex + 2; // +1 for zero-based index, +1 for sheet header row
    const receiverRow = receiverIndex + 2;

    await updateData(`Economy!D${senderRow}`, [[newSenderBalance]]);
    await updateData(`Economy!D${receiverRow}`, [[newReceiverBalance]]);

    try {
      const dmEmbed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle(`${E.money || '💰'} Payment Received`)
        .setDescription(
          `${E.team} From Club: **${senderClubName}**\n` +
          `${E.team} To Club: **${receiverClubName}**\n` +
          `${E.money || '💰'} Amount: **${amount.toLocaleString()} SiuuCoins**\n\n` +
          `${E.correct} New Club Balance: **${newReceiverBalance.toLocaleString()} SiuuCoins**`
        );

      await target.send({
        embeds: [dmEmbed]
      });
    } catch {}

    const embed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setTitle(`${E.success} Payment Successful`)
      .setDescription(
        `${E.team} From Club: **${senderClubName}**\n` +
        `${E.team} To Club: **${receiverClubName}**\n` +
        `${E.money || '💰'} Amount: **${amount.toLocaleString()} SiuuCoins**\n\n` +
        `${E.profile} Your Club Balance: **${newSenderBalance.toLocaleString()} SiuuCoins**\n` +
        `${E.profile} Recipient Club Balance: **${newReceiverBalance.toLocaleString()} SiuuCoins**`
      );

    return {
      embeds: [embed]
    };
  }
};
