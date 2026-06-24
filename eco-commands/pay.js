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
    .addStringOption(option =>
      option
        .setName('amount')
        .setDescription('Amount of SiuuCoins (e.g. 5000, 300k, 10m, 10e6)')
        .setRequired(true)
    ),

  async execute(interaction) {
    const target = interaction.options.getUser('user');

    const amountInput = String(interaction.options.getString('amount') || '')
      .trim()
      .replace(/,/g, '')
      .toLowerCase();

    let amount;

    const match = amountInput.match(/^(\d+(?:\.\d+)?)(k|m|b|e6)?$/i);

    if (match) {
      const value = parseFloat(match[1]);
      const suffix = (match[2] || '').toLowerCase();

      switch (suffix) {
        case 'k':
          amount = Math.floor(value * 1_000);
          break;
        case 'm':
        case 'e6':
          amount = Math.floor(value * 1_000_000);
          break;
        case 'b':
          amount = Math.floor(value * 1_000_000_000);
          break;
        default:
          amount = Math.floor(value);
      }
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

    const senderPlayerName = String(economy[senderIndex][2] || interaction.user.username);
    const receiverPlayerName = String(economy[receiverIndex][2] || target.username);

    const senderRow = senderIndex + 2; // +1 for zero-based index, +1 for sheet header row
    const receiverRow = receiverIndex + 2;

    await updateData(`Economy!D${senderRow}`, [[newSenderBalance]]);
    await updateData(`Economy!D${receiverRow}`, [[newReceiverBalance]]);

    try {
      const dmEmbed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle(`${E.money || '💰'} Payment Received`)
        .setDescription(
          `${E.profile} From: **${interaction.user.tag}**\n` +
          `${E.profile} Player: **${senderPlayerName}**\n\n` +
          `${E.profile} To: **${target.tag}**\n` +
          `${E.profile} Player: **${receiverPlayerName}**\n\n` +
          `${E.money || '💰'} Amount: **${amount.toLocaleString()} SiuuCoins**\n` +
          `${E.correct} New Balance: **${newReceiverBalance.toLocaleString()} SiuuCoins**`
        );

      await target.send({
        embeds: [dmEmbed]
      });
    } catch {}

    const embed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setTitle(`${E.success} Payment Successful`)
      .setDescription(
        `${E.profile} Sender: **${interaction.user.tag}**\n` +
        `${E.profile} Player: **${senderPlayerName}**\n\n` +
        `${E.profile} Receiver: **${target.tag}**\n` +
        `${E.profile} Player: **${receiverPlayerName}**\n\n` +
        `${E.money || '💰'} Amount: **${amount.toLocaleString()} SiuuCoins**\n\n` +
        `${E.money || '💰'} Your Balance: **${newSenderBalance.toLocaleString()} SiuuCoins**\n` +
        `${E.money || '💰'} Recipient Balance: **${newReceiverBalance.toLocaleString()} SiuuCoins**`
      );

    return {
      embeds: [embed]
    };
  }
};
