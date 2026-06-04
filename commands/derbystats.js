const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const cachedGetData = require('../utils/helpers').cachedGetData;
const E = require('../utils/emojis');

// --- Helper functions ---
function clean(str) {
  return (str || '').trim();
}

function normalize(str) {
  return clean(str).toLowerCase().replace(/[\s_\-]+/g, '');
}

function safeEmoji(emoji) {
  return emoji || '';
}

function addPlayerStat(map, name, val = 1) {
  if (!name) return;
  name = clean(name);
  if (!name) return;
  map[name] = (map[name] || 0) + val;
}

function buildHubEmbed(derbies) {
  const embed = new EmbedBuilder()
    .setTitle(`${safeEmoji(E.fire)} Derby Hub`)
    .setDescription('Select a derby below to view detailed stats.')
    .setColor(0xE67E22);
  derbies.forEach((d) => {
    embed.addFields({
      name: `${safeEmoji(E.fire, '🔥')} ${d.derbyName}`,
      value: `${d.team1} ${safeEmoji(E.vs, '🆚')} ${d.team2}`,
      inline: false,
    });
  });
  return embed;
}

function buildDerbyEmbed(derby, stats) {
  const {
    played,
    team1Wins,
    team2Wins,
    draws,
    team1Goals,
    team2Goals,
    goals,
    assists,
    mvps
  } = stats;

  const team1 = derby.team1;
  const team2 = derby.team2;

  const topGoals = Object.entries(goals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([p, v]) => `• ${p} (${v})`)
    .join('\n') || 'None';

  const topAssists = Object.entries(assists)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([p, v]) => `• ${p} (${v})`)
    .join('\n') || 'None';

  const topMvps = Object.entries(mvps)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([p, v]) => `• ${p} (${v})`)
    .join('\n') || 'None';

  return new EmbedBuilder()
    .setColor(0xE67E22)
    .setTitle(`${safeEmoji(E.fire)} ${derby.derbyName}`)
    .setDescription(`${team1} vs ${team2}`)
    .addFields(
      {
        name: `${safeEmoji(E.Stats)} Overall Record`,
        value:
          `${safeEmoji(E.played)} Matches: **${played}**\n` +
          `${safeEmoji(E.win)} ${team1}: **${team1Wins}W**\n` +
          `${safeEmoji(E.win)} ${team2}: **${team2Wins}W**\n` +
          `${safeEmoji(E.draw)} Draws: **${draws}**`
      },
      {
        name: `${safeEmoji(E.goal)} Goals`,
        value:
          `${team1}: ${safeEmoji(E.goal)} **${team1Goals}**\n` +
          `${team2}: ${safeEmoji(E.goal)} **${team2Goals}**`
      },
      {
        name: `${safeEmoji(E.goldenBoot)} Top Scorers`,
        value: topGoals,
        inline: false
      },
      {
        name: `${safeEmoji(E.assist)} Top Assists`,
        value: topAssists,
        inline: false
      },
      {
        name: `${safeEmoji(E.mvp)} Top MVPs`,
        value: topMvps,
        inline: false
      }
    );
}

async function getDerbies() {
  // Columns: Derby Name, Team 1, Team 2, Active
  const rows = await cachedGetData('Derbies!A:D');
  const activeVals = ['yes', 'active', 'true', '1'];
  return rows
    .slice(1)
    .filter(
      (row) =>
        row &&
        row[0] &&
        row[1] &&
        row[2] &&
        row[3] &&
        activeVals.includes(normalize(row[3]))
    )
    .map((row) => ({
      derbyName: clean(row[0]),
      team1: clean(row[1]),
      team2: clean(row[2]),
      active: clean(row[3])
    }));
}

async function getAllMatches() {
  // Returns array of all match rows from all sheets
  const sheets = [
    'Matches_Entry!A:S',
    'FA_Cup_Coop_Results!A:S',
    'Carabao_Coop_Results!A:S',
    'UCL_Coop_Results!A:S',
  ];
  let all = [];
  for (const s of sheets) {
    const rows = await cachedGetData(s);
    if (Array.isArray(rows)) all = all.concat(rows);
  }
  return all;
}

function calcDerbyStats(derby, matches) {
  const t1 = normalize(derby.team1);
  const t2 = normalize(derby.team2);
  let played = 0,
    team1Wins = 0,
    team2Wins = 0,
    draws = 0,
    team1Goals = 0,
    team2Goals = 0;
  const goals = {}, assists = {}, mvps = {};
  matches.forEach((row) => {
    // Home Team = row[1], Away Team = row[2], HG = row[3], AG = row[4], Scorers = row[7], Assists = row[8], MVP = row[11]
    const home = normalize(row[1]);
    const away = normalize(row[2]);
    if (
      (home === t1 && away === t2) ||
      (home === t2 && away === t1)
    ) {
      played++;
      // Parse scores
      let hg = parseInt(row[3], 10) || 0;
      let ag = parseInt(row[4], 10) || 0;
      let t1Goals = 0, t2Goals = 0;
      if (home === t1) {
        t1Goals = hg;
        t2Goals = ag;
      } else {
        t1Goals = ag;
        t2Goals = hg;
      }
      team1Goals += t1Goals;
      team2Goals += t2Goals;
      // Determine result
      if (t1Goals > t2Goals) team1Wins++;
      else if (t2Goals > t1Goals) team2Wins++;
      else draws++;
      // Scorers (format: "Player1 (2), Player2")
      const scorers = (row[7] || '').split(',').map(s => clean(s));
      scorers.forEach((entry) => {
        if (!entry) return;
        // Try to parse "Name (N)"
        const m = entry.match(/^(.+?)(?:\s*\((\d+)\))?$/);
        if (!m) return;
        const name = clean(m[1]);
        const count = m[2] ? parseInt(m[2], 10) : 1;
        addPlayerStat(goals, name, count);
      });
      // Assists (format: "Player1 (2), Player2")
      const assistsArr = (row[8] || '').split(',').map(s => clean(s));
      assistsArr.forEach((entry) => {
        if (!entry) return;
        const m = entry.match(/^(.+?)(?:\s*\((\d+)\))?$/);
        if (!m) return;
        const name = clean(m[1]);
        const count = m[2] ? parseInt(m[2], 10) : 1;
        addPlayerStat(assists, name, count);
      });
      // MVP (can be multiple, comma-separated)
      const mvpArr = (row[11] || '').split(',').map(s => clean(s));
      mvpArr.forEach((name) => addPlayerStat(mvps, name, 1));
    }
  });
  return { played, team1Wins, team2Wins, draws, team1Goals, team2Goals, goals, assists, mvps };
}

// --- Command Export ---
module.exports = {
  data: new SlashCommandBuilder()
    .setName('derbystats')
    .setDescription('View stats for all derbies.'),
  async execute(interaction) {
    const derbies = await getDerbies();
    const embed = buildHubEmbed(derbies);
    // Build select menu
    const options = derbies.map((d, i) => ({
      label: d.derbyName,
      value: String(i),
      description: `${d.team1} vs ${d.team2}`.slice(0, 80),
    }));
    const select = new StringSelectMenuBuilder()
      .setCustomId('derbystats_select')
      .setPlaceholder('Choose a derby...')
      .addOptions(options);
    const row = new ActionRowBuilder().addComponents(select);
    // Add buttons
    const btnRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('derbystats_refresh')
        .setLabel('Refresh')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(E.fire || undefined)
    );
    return {
      embeds: [embed],
      components: [row, btnRow]
    };
  },
  async selectMenuHandler(interaction) {
    if (interaction.customId !== 'derbystats_select') return;
    const derbies = await getDerbies();
    const idx = parseInt(interaction.values[0], 10);
    if (isNaN(idx) || !derbies[idx]) return;
    const derby = derbies[idx];
    const matches = await getAllMatches();
    const stats = calcDerbyStats(derby, matches);
    const embed = buildDerbyEmbed(derby, stats);
    // Add select menu and Back/Refresh buttons
    const options = derbies.map((d, i) => ({
      label: d.derbyName,
      value: String(i),
      description: `${d.team1} vs ${d.team2}`.slice(0, 80),
    }));
    const select = new StringSelectMenuBuilder()
      .setCustomId('derbystats_select')
      .setPlaceholder('Choose a derby...')
      .addOptions(options);
    const row = new ActionRowBuilder().addComponents(select);
    const btnRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('derbystats_back')
        .setLabel('Back')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(E.Stats || undefined),
      new ButtonBuilder()
        .setCustomId('derbystats_refresh')
        .setLabel('Refresh')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(E.fire || undefined)
    );
    return {
      embeds: [embed],
      components: [row, btnRow]
    };
  },
  async buttonHandler(interaction) {
    if (interaction.customId === 'derbystats_back') {
      const derbies = await getDerbies();
      const embed = buildHubEmbed(derbies);
      const options = derbies.map((d, i) => ({
        label: d.derbyName,
        value: String(i),
        description: `${d.team1} vs ${d.team2}`.slice(0, 80),
      }));
      const select = new StringSelectMenuBuilder()
        .setCustomId('derbystats_select')
        .setPlaceholder('Choose a derby...')
        .addOptions(options);
      const row = new ActionRowBuilder().addComponents(select);
      const btnRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('derbystats_refresh')
          .setLabel('Refresh')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji(E.fire || undefined)
      );
      return {
        embeds: [embed],
        components: [row, btnRow]
      };
    }
    if (interaction.customId === 'derbystats_refresh') {
      // Try to preserve current selection if possible
      // Find if select menu is present and which value is selected
      const msg = interaction.message;
      let selectedIdx = null;
      try {
        const select = msg.components?.[0]?.components?.find(c => c.customId === 'derbystats_select');
        if (select && select.data?.value) selectedIdx = parseInt(select.data.value, 10);
        else if (select && select.options?.some(o => o.default)) {
          selectedIdx = parseInt(select.options.find(o => o.default).value, 10);
        }
      } catch (e) {}
      const derbies = await getDerbies();
      if (selectedIdx !== null && derbies[selectedIdx]) {
        // Show that derby
        const derby = derbies[selectedIdx];
        const matches = await getAllMatches();
        const stats = calcDerbyStats(derby, matches);
        const embed = buildDerbyEmbed(derby, stats);
        const options = derbies.map((d, i) => ({
          label: d.derbyName,
          value: String(i),
          description: `${d.team1} vs ${d.team2}`.slice(0, 80),
        }));
        const select = new StringSelectMenuBuilder()
          .setCustomId('derbystats_select')
          .setPlaceholder('Choose a derby...')
          .addOptions(options);
        const row = new ActionRowBuilder().addComponents(select);
        const btnRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('derbystats_back')
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(E.Stats || undefined),
          new ButtonBuilder()
            .setCustomId('derbystats_refresh')
            .setLabel('Refresh')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(E.fire || undefined)
        );
        return {
          embeds: [embed],
          components: [row, btnRow]
        };
      } else {
        // Show hub
        const embed = buildHubEmbed(derbies);
        const options = derbies.map((d, i) => ({
          label: d.derbyName,
          value: String(i),
          description: `${d.team1} vs ${d.team2}`.slice(0, 80),
        }));
        const select = new StringSelectMenuBuilder()
          .setCustomId('derbystats_select')
          .setPlaceholder('Choose a derby...')
          .addOptions(options);
        const row = new ActionRowBuilder().addComponents(select);
        const btnRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('derbystats_refresh')
            .setLabel('Refresh')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(E.fire || undefined)
        );
        return {
          embeds: [embed],
          components: [row, btnRow]
        };
      }
    }
  },
};
