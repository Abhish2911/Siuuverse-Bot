const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getData, updateData } = require('../utils/sheets');
const { invalidateSheetCache } = require('../utils/helpers');
const E = require('../utils/emojis');

const COOP_PLAYER_ROLE_ID = String(process.env.COOP_PLAYER_ROLE_ID || '').trim();
const COOP_MAX_PLAYERS_PER_TEAM = Number.parseInt(process.env.COOP_MAX_PLAYERS_PER_TEAM || '3', 10);

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function cleanId(value) {
  return String(value || '').replace(/[<@!>]/g, '').trim();
}

function splitList(value) {
  return String(value || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

async function addRole(member, roleId) {
  if (!member || !roleId) return false;
  if (member.roles.cache.has(roleId)) return true;
  await member.roles.add(roleId);
  return true;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addplayer')
    .setDescription('Captain: add a player to your coop team')
    .addUserOption(opt =>
      opt
        .setName('user')
        .setDescription('Player Discord tag')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName('player')
        .setDescription('Player in-game name')
        .setRequired(true)
    ),

  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const playerName = String(interaction.options.getString('player') || '').trim();
    const captainId = interaction.user.id;
    const userId = user.id;

    if (user.bot) {
      return { content: `${E.wrong} You cannot add a bot as a player.` };
    }

    if (playerName.length < 2 || playerName.length > 24) {
      return { content: `${E.wrong} Player name must be between 2-24 characters.` };
    }

    if (playerName.includes(',')) {
      return { content: `${E.wrong} Player name cannot contain comma.` };
    }

    const sheet = await getData('Teams!A:H');
    const rows = Array.isArray(sheet) ? sheet.slice(1).map(r => [...r]) : [];

    const teamIndex = rows.findIndex(row => cleanId(row[4]) === captainId);

    if (teamIndex === -1) {
      return { content: `${E.lock} Only a registered team captain can add players.` };
    }

    const alreadyRegistered = rows.find(row => {
      const captain = cleanId(row[4]);
      const members = splitList(row[5]).map(cleanId);
      return captain === userId || members.includes(userId);
    });

    if (alreadyRegistered) {
      return { content: `${E.wrong} ${user} is already registered in **${alreadyRegistered[0]}**.` };
    }

    const nameUsed = rows.find(row => {
      const players = splitList(row[1]).map(normalize);
      return players.includes(normalize(playerName));
    });

    if (nameUsed) {
      return { content: `${E.wrong} Player name **${playerName}** is already used in **${nameUsed[0]}**.` };
    }

    const team = rows[teamIndex];
    while (team.length < 8) team.push('');

    const players = splitList(team[1]);
    const memberIds = splitList(team[5]).map(cleanId);

    if (players.length >= COOP_MAX_PLAYERS_PER_TEAM) {
      return { content: `${E.lock} Team is full. Max players per team is **${COOP_MAX_PLAYERS_PER_TEAM}**.` };
    }

    players.push(playerName);
    memberIds.push(userId);

    team[1] = players.join(', ');
    team[5] = memberIds.join(', ');
    rows[teamIndex] = team;

    await updateData('Teams!A2:H', rows);
    invalidateSheetCache(['Teams!', 'Teams!A:G', 'Teams!A:H']);

    let roleText = 'Not set';
    try {
      if (COOP_PLAYER_ROLE_ID) {
        const member = await interaction.guild.members.fetch(userId);
        const added = await addRole(member, COOP_PLAYER_ROLE_ID);
        roleText = added ? `<@&${COOP_PLAYER_ROLE_ID}>` : 'Failed';
      }
    } catch (error) {
      console.error('❌ Add player role error:', error);
      roleText = `Failed: ${error.message}`;
    }

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle(`${E.correct} Player Added`)
          .setDescription(
            `${E.blueIcon} **Team:** ${team[0]} • **${team[2] || 'N/A'}**\n` +
            `${E.played} **Player:** ${playerName}\n` +
            `${E.profile} **User:** ${user}\n` +
            `${E.up} **Role:** ${roleText}\n` +
            `${E.calendar} **Squad:** ${players.length}/${COOP_MAX_PLAYERS_PER_TEAM}`
          )
          .setColor(0x2ECC71)
          .setFooter({ text: 'SiuuVerse Coop Team' })
      ]
    };
  }
};
