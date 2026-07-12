const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const emojis = require('../utils/emojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rpshop')
    .setDescription('View the RP Shop.'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0xF1C40F)
      .setTitle('🏪 SIUUVERSE RP SHOP')
      .setDescription([
       `## 🏋️ Training Point`,
       `${emojis.money || '💰'} **Price (Per TP):**`,
       `• **75-79 OVR** → **150,000 SiuuCoins**`,
       `• **80-84 OVR** → **200,000 SiuuCoins**`,
       `• **85-89 OVR** → **300,000 SiuuCoins**`,
       `• **90-94 OVR** → **400,000 SiuuCoins**`,
       `• **95-99 OVR** → **500,000 SiuuCoins**`,
       ``,
       `${emojis.up} Grants **+1 Training Point**.`,
       `${emojis.rank} Cost is based on your **current OVR**.`,
       `${emojis.rank} OVR & Market Value update automatically.`,
       ``,
       `## 📜 Purchase Limits`,
       `• Maximum **5 Training Points** may be purchased every season.`,
       `• Season purchase limit resets every **10 days**.`,
       ].join('\n'))
      .setFooter({
        text: 'Season 2 Prices • Subject to change'
      })
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed]
    });
  }
};