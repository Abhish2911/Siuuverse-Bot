const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { cachedGetData } = require('../utils/helpers');
const E = require('../utils/emojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('View your economy balance')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('Check another user balance')
        .setRequired(false)
    ),

  async execute(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;

    const economy = await cachedGetData('Economy!A:D');

    const row = economy
      .slice(1)
      .find(r => String(r[1] || '').trim() === target.id);

    if (!row) {
      const isSelf = target.id === interaction.user.id;

      const embed = new EmbedBuilder()
        .setColor(0xE74C3C)
        .setDescription(
          isSelf
            ? `${E.error} You do not have an economy account.`
            : `${E.error} This user does not own a club.`
        );

      return { embeds: [embed] };
    }

    const clubName = String(row[0] || 'Unknown Club');
    const playerName = String(row[2] || target.username);
    const balance = Number(String(row[3] || '0').replace(/,/g, '')) || 0;

    const embed = new EmbedBuilder()
      .setColor(0xF1C40F)
      .setTitle(`${E.money || '💰'} Player Balance`)
      .setDescription(
        `${E.profile} User: **${target.tag}**\n` +
        `${E.profile} Player: **${playerName}**\n` +
        `${E.team} Club: **${clubName}**\n\n` +
        `${E.money || '💰'} Balance: **${balance.toLocaleString()} SiuuCoins**`
      )
      .setFooter({ text: 'SiuuVerse Economy' });

    return {
      embeds: [embed]
    };
  }
};
