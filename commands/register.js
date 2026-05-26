const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getData, updateData, appendData } = require('../utils/sheets');
const { invalidateSheetCache } = require('../utils/helpers');
const E = require('../utils/emojis');

const COOP_TEAM_LIMIT = Number.parseInt(process.env.COOP_TEAM_LIMIT || '8', 10);
const COOP_PLAYER_ROLE_ID = String(process.env.COOP_PLAYER_ROLE_ID || '').trim();
const COOP_CAPTAIN_ROLE_ID = String(process.env.COOP_CAPTAIN_ROLE_ID || '').trim();

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function cleanId(value) {
  return String(value || '').replace(/[<@!>]/g, '').trim();
}

function isValidUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function isValidShortName(value) {
  return /^[A-Z]{3}$/.test(String(value || '').trim().toUpperCase());
}

function cleanRows(rows) {
  return Array.isArray(rows)
    ? rows.slice(1).filter(row => row.some(cell => String(cell || '').trim()))
    : [];
}

function generateNextTeamId(teamIdRows) {
  const ids = cleanRows(teamIdRows)
    .map(row => String(row[1] || '').trim())
    .filter(Boolean);

  const maxNumber = ids.reduce((max, id) => {
    const match = id.match(/^T(\d+)$/i);
    if (!match) return max;
    return Math.max(max, Number(match[1]));
  }, 0);

  return `T${String(maxNumber + 1).padStart(3, '0')}`;
}

async function addRole(member, roleId) {
  if (!member || !roleId) return false;
  if (member.roles.cache.has(roleId)) return true;
  await member.roles.add(roleId);
  return true;
}

async function sendReply(interaction, payload) {
  return payload;
}

function buildRegisterSummary(teamName, shortName, teamId, playerName, stadium, previousTeam, previousShort, playerRoleText, captainRoleText, filledTeams) {
  return {
    teamName,
    shortName,
    teamId,
    playerName,
    stadium,
    previousTeam,
    previousShort,
    playerRoleText,
    captainRoleText,
    spot: `${filledTeams + 1}/${COOP_TEAM_LIMIT}`
  };
}

function buildRegisterDescription(summary, captainId) {
  return (
    `${E.blueIcon} **Team:** ${summary.teamName} • **${summary.shortName}**\n` +
    `🆔 **Team ID:** ${summary.teamId}\n` +
    `${E.played} **Captain Player:** ${summary.playerName}\n` +
    `${E.mvp} **Captain:** <@${captainId}>\n` +
    `🏟️ **Stadium:** ${summary.stadium}\n\n` +
    `🔁 **Previous Team:** ${summary.previousTeam}\n\n` +
    `🔤 **Previous Short:** ${summary.previousShort}\n\n` +
    `${E.up} **Player Role:** ${summary.playerRoleText}\n` +
    `${E.goldenBoot} **Captain Role:** ${summary.captainRoleText}\n` +
    `${E.calendar} **Spot:** ${summary.spot}`
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('register')
    .setDescription('Register your coop team')
    .addStringOption(opt =>
      opt
        .setName('team')
        .setDescription('Team name')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName('short')
        .setDescription('3-letter short name like BNR, SCT, CCT')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName('player')
        .setDescription('Captain in-game player name')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName('stadium')
        .setDescription('Team stadium')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt
        .setName('logo')
        .setDescription('Team logo URL')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt
        .setName('previous_team')
        .setDescription('Previous season team name, or same/current team if staying')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt
        .setName('previous_short')
        .setDescription('Previous season short name, or same/current short if staying')
        .setRequired(false)
    ),

  async execute(interaction) {
    const teamName = String(interaction.options.getString('team') || '').trim();
    const shortName = String(interaction.options.getString('short') || '').trim().toUpperCase();
    const playerName = String(interaction.options.getString('player') || '').trim();
    const stadium = String(interaction.options.getString('stadium') || 'Not set').trim();
    const logo = String(interaction.options.getString('logo') || '').trim();
    const previousTeamInput = String(interaction.options.getString('previous_team') || '').trim();
    const previousTeam = previousTeamInput || teamName;
    const previousShortInput = String(interaction.options.getString('previous_short') || '').trim().toUpperCase();
    const previousShort = previousShortInput || shortName;

    const captainId = interaction.user.id;

    if (teamName.length < 2 || teamName.length > 32) {
      return sendReply(interaction, {
        content: `${E.wrong} Team name must be between 2-32 characters.`,
        ephemeral: true
      });
    }

    if (!isValidShortName(shortName)) {
      return sendReply(interaction, {
        content: `${E.wrong} Short name must be exactly **3 letters only** like **BNR, SCT, CCT, RDN, BBG, MMU, LLC, LPO**.`,
        ephemeral: true
      });
    }

    if (playerName.length < 2 || playerName.length > 24) {
      return sendReply(interaction, {
        content: `${E.wrong} Player name must be between 2-24 characters.`,
        ephemeral: true
      });
    }

    if ([teamName, shortName, playerName, stadium, previousTeam].some(v => v.includes(','))) {
      return sendReply(interaction, {
        content: `${E.wrong} Commas are not allowed in names.`,
        ephemeral: true
      });
    }

    if (logo && !isValidUrl(logo)) {
      return sendReply(interaction, {
        content: `${E.wrong} Invalid logo URL.`,
        ephemeral: true
      });
    }

    const [sheet, teamIdRows] = await Promise.all([
      getData('Teams!A:G'),
      getData('Team_ID_Map!A:E').catch(() => [])
    ]);
    const rows = Array.isArray(sheet)
      ? sheet.slice(1).map(r => [...r])
      : [];

    const filledTeams = rows.filter(r => r[0]);

    const existingTeam = rows.find(r => normalize(r[0]) === normalize(teamName));
    const existingShort = rows.find(r => normalize(r[2]) === normalize(shortName));

    const teamIdMapRows = cleanRows(teamIdRows);
    const existingMapTeam = teamIdMapRows.find(r => normalize(r[2]) === normalize(teamName));
    const existingMapShort = teamIdMapRows.find(r => normalize(r[0]) === normalize(shortName));

    const existingCaptain = rows.find(r => {
      const captain = cleanId(r[4]);
      const members = String(r[5] || '')
        .split(',')
        .map(cleanId)
        .filter(Boolean);

      return captain === captainId || members.includes(captainId);
    });

    if (filledTeams.length >= COOP_TEAM_LIMIT) {
      return sendReply(interaction, {
        content: `${E.lock} Coop registrations full. Limit is ${COOP_TEAM_LIMIT}.`,
        ephemeral: true
      });
    }

    if (existingTeam) {
      return sendReply(interaction, {
        content: `${E.wrong} Team already registered.`,
        ephemeral: true
      });
    }

    if (existingShort) {
      return sendReply(interaction, {
        content: `${E.wrong} Short name already used.`,
        ephemeral: true
      });
    }

    if (existingMapTeam) {
      return sendReply(interaction, {
        content: `${E.wrong} Team already exists in Team_ID_Map.`,
        ephemeral: true
      });
    }

    if (existingMapShort) {
      return sendReply(interaction, {
        content: `${E.wrong} Short name already exists in Team_ID_Map.`,
        ephemeral: true
      });
    }

    if (existingCaptain) {
      return sendReply(interaction, {
        content: `${E.wrong} You are already registered in ${existingCaptain[0]}.`,
        ephemeral: true
      });
    }

    const teamId = generateNextTeamId(teamIdRows);

    // captain is automatically the user running the command
    rows.push([
      teamName,
      playerName,
      shortName,
      logo,
      captainId,
      '',
      stadium
    ]);

    await updateData('Teams!A2:G', rows);
    await appendData('Team_ID_Map!A:E', [[shortName, teamId, teamName, previousTeam, previousShort]]);

    invalidateSheetCache([
      'Teams!',
      'Teams!A:G',
      'Team_ID_Map!',
      'Team_ID_Map!A:E'
    ]);

    let playerRoleText = 'Not set';
    let captainRoleText = 'Not set';

    try {
      const member = await interaction.guild.members.fetch(captainId);

      if (COOP_PLAYER_ROLE_ID) {
        const added = await addRole(member, COOP_PLAYER_ROLE_ID);
        playerRoleText = added
          ? `<@&${COOP_PLAYER_ROLE_ID}>`
          : 'Failed';
      }

      if (COOP_CAPTAIN_ROLE_ID) {
        const added = await addRole(member, COOP_CAPTAIN_ROLE_ID);
        captainRoleText = added
          ? `<@&${COOP_CAPTAIN_ROLE_ID}>`
          : 'Failed';
      }
    } catch (error) {
      console.error('❌ Coop register role error:', error);
      playerRoleText = 'Failed';
      captainRoleText = 'Failed';
    }

    const summary = buildRegisterSummary(
      teamName,
      shortName,
      teamId,
      playerName,
      stadium,
      previousTeam,
      previousShort,
      playerRoleText,
      captainRoleText,
      filledTeams.length
    );

    const embed = new EmbedBuilder()
      .setTitle(`${E.correct} Coop Team Registered`)
      .setDescription(buildRegisterDescription(summary, captainId))
      .addFields(
        { name: '🏷️ Team', value: `**${summary.teamName}**`, inline: true },
        { name: '🔤 Short', value: `**${summary.shortName}**`, inline: true },
        { name: '🆔 Team ID', value: `**${summary.teamId}**`, inline: true },
        { name: '📅 Spot', value: `**${summary.spot}**`, inline: true },
        { name: '👤 Captain Player', value: summary.playerName, inline: true },
        { name: '🏟️ Stadium', value: summary.stadium, inline: true },
        { name: '🔁 Previous Team', value: summary.previousTeam, inline: true },
        { name: '🔤 Previous Short', value: summary.previousShort, inline: true },
        { name: '🎭 Roles', value: `Player: ${summary.playerRoleText}\nCaptain: ${summary.captainRoleText}`, inline: true }
      )
      .setColor(0x2ECC71)
      .setFooter({ text: 'Register • Teams + Team_ID_Map updated' });

    if (logo) embed.setThumbnail(logo);

    return sendReply(interaction, { embeds: [embed] });
  }
};