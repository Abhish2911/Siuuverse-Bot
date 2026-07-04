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
      return { content: '❌ Only bot owners can use this command.' };
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
      return { content: '❌ Invalid amount format. Use e.g. `50000`, `50k`, `2m`.' };
    }
    if (amount <= 0) {
      return { content: '❌ Amount must be greater than zero.' };
    }

    // Get economy data
    const economyData = await cachedGetData('Economy!A:D', {
      spreadsheetId: process.env.RP_SHEET_ID
    });
    const economy = economyData.slice(1);

    // Find player row by UserID in column B (index 1)
    const playerRowIndex = economy.findIndex(row => String(row[1]).trim() === targetUser.id);
    if (playerRowIndex === -1) {
      return { content: `${E.error} Could not find that player in the database.` };
    }
    const playerRow = economy[playerRowIndex];

    // Find FA row by Club Name 'The FA' in column A (index 0) OR UserID '844445906845433906' in column B (index 1)
    const faRowIndex = economy.findIndex(row =>
      String(row[0]).trim() === 'The FA' ||
      String(row[1]).trim() === '844445906845433906'
    );
    if (faRowIndex === -1) {
      return { content: `${E.error} Could not find the FA club in the database.` };
    }
    const faClubRow = economy[faRowIndex];

    // Check FA balance (column D, index 3)
    let faBalance = Number(String(faClubRow[3] || '0').replace(/,/g, '')) || 0;
    console.log('[FAPAY] FA Row:', faClubRow);
    console.log('[FAPAY] Parsed FA Balance:', faBalance);
    if (isNaN(faBalance)) faBalance = 0;
    if (faBalance < amount) {
      return { content: `${E.error} The FA club does not have enough balance for this payment.` };
    }

    // Update balances (column D, index 3)
    const newFaBalance = faBalance - amount;
    let playerBalance = Number(String(playerRow[3] || '0').replace(/,/g, '')) || 0;
    if (isNaN(playerBalance)) playerBalance = 0;
    const newPlayerBalance = playerBalance + amount;

    const faRow = faRowIndex + 2;
    const playerRowNumber = playerRowIndex + 2;

    await updateData(`Economy!D${faRow}`, [[newFaBalance]], {
      spreadsheetId: process.env.RP_SHEET_ID
    });

    await updateData(`Economy!D${playerRowNumber}`, [[newPlayerBalance]], {
      spreadsheetId: process.env.RP_SHEET_ID
    });

    // DM the recipient
    try {
      const dmEmbed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle(`${E.success} FA Reward Received`)
        .setDescription(
          `${E.FA} **The FA** has rewarded you.\n\n` +
          `${E.profile} **Player:** ${playerRow[2]}\n` +
          `${E.trophy} **Reason:** ${reason}\n\n` +
          `${E.greenIcon} **Reward:** ${amount.toLocaleString()} SiuuCoins\n` +
          `${E.trophy} **New Balance:** ${newPlayerBalance.toLocaleString()} SiuuCoins`
        )
        .setTimestamp();
      await targetUser.send({ embeds: [dmEmbed] });
    } catch (err) {
      // Ignore DM errors
    }

    // Reply with improved success embed
    const embed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setTitle(`${E.success} FA Payment Successful`)
      .setDescription(`${E.FA} Reward issued successfully from **The FA**.`)
      .addFields(
        {
          name: `${E.profile} Recipient`,
          value: `${targetUser}\n**${playerRow[2]}**`,
          inline: true
        },
        {
          name: `${E.greenIcon} Reward`,
          value: `**${amount.toLocaleString()} SiuuCoins**`,
          inline: true
        },
        {
          name: `${E.trophy} Reason`,
          value: reason,
          inline: false
        },
        {
          name: `${E.money || '💰'} Recipient Balance`,
          value: `**${newPlayerBalance.toLocaleString()} SiuuCoins**`,
          inline: true
        },
        {
          name: `${E.FA} FA Balance`,
          value: `**${newFaBalance.toLocaleString()} SiuuCoins**`,
          inline: true
        }
      )
      .setTimestamp();

    return { embeds: [embed] };
  }
};
