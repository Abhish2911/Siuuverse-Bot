const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { getData, updateData } = require('../utils/sheets');
const {
  buildMixedPrefixList,
  invalidateSheetCache,
  sendAuditLog
} = require('../utils/helpers');
const { refreshLiveStandings } = require('../utils/liveStandings');
const E = require('../utils/emojis');

const pendingEdits = new Map();

function isOwner(interaction) {
  const ownerIds = String(process.env.OWNER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  return (
    ownerIds.includes(interaction.user.id) ||
    interaction.guild?.ownerId === interaction.user.id
  );
}

const normalize = value => String(value || '').trim().toLowerCase();
const hasScore = row => row[4] !== '' && row[4] !== undefined && row[5] !== '' && row[5] !== undefined;

function safeEmoji(value, fallback = '') {
  return value || fallback;
}

function splitRawEntries(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function compactCountList(value, empty = 'None') {
  const entries = splitRawEntries(value);
  if (!entries.length) return empty;

  const counts = new Map();
  for (const entry of entries) {
    counts.set(entry, (counts.get(entry) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([name, count]) => `• ${name} (${count})`)
    .join('\n');
}

function repeatedCount(value) {
  return splitRawEntries(value).length;
}

function hasExplicitPrefix(value, homeShort, awayShort) {
  const text = String(value || '').trim().toUpperCase();
  const home = String(homeShort || '').trim().toUpperCase();
  const away = String(awayShort || '').trim().toUpperCase();

  return Boolean(
    (home && (text.startsWith(`${home}-`) || text.startsWith(`${home} -`))) ||
    (away && (text.startsWith(`${away}-`) || text.startsWith(`${away} -`)))
  );
}

function preserveExplicitPrefixes(rawValue, builtValue, homePlayers, awayPlayers, homeShort, awayShort) {
  const rawEntries = splitRawEntries(rawValue);
  if (!rawEntries.length) return builtValue;

  const builtEntries = splitRawEntries(builtValue);
  if (!builtEntries.length) return builtValue;

  const stripKnownPrefix = value => {
    const text = String(value || '').trim();
    const home = String(homeShort || '').trim();
    const away = String(awayShort || '').trim();

    if (home && new RegExp(`^${home}\\s*-\\s*`, 'i').test(text)) {
      return text.replace(new RegExp(`^${home}\\s*-\\s*`, 'i'), '').trim();
    }

    if (away && new RegExp(`^${away}\\s*-\\s*`, 'i').test(text)) {
      return text.replace(new RegExp(`^${away}\\s*-\\s*`, 'i'), '').trim();
    }

    return text;
  };

  const normalizeBaseName = value => stripKnownPrefix(value).toLowerCase();
  const used = new Set();

  const updated = builtEntries.map(entry => {
    const builtBase = normalizeBaseName(entry);

    for (let i = 0; i < rawEntries.length; i++) {
      if (used.has(i)) continue;

      const rawEntry = rawEntries[i];
      if (!hasExplicitPrefix(rawEntry, homeShort, awayShort)) continue;

      const rawBase = normalizeBaseName(rawEntry);

      if (rawBase && rawBase === builtBase) {
        used.add(i);
        return rawEntry;
      }
    }

    return entry;
  });

  return updated.join(', ');
}

function buildMatchLabel(row) {
  const matchNo = String(row[0] || '-');
  const home = String(row[7] || row[2] || 'HOME');
  const away = String(row[8] || row[3] || 'AWAY');
  const score = hasScore(row) ? `${row[4]}-${row[5]}` : 'vs';
  return `${matchNo} | ${home} ${score} ${away}`.slice(0, 100);
}

// --- UI helpers for edit result confirmation/summary ---
function buildEditResultSummary(matchNo, oldScore, payload, fixture, homeTeam, awayTeam) {
  const home = String(fixture?.[7] || fixture?.[2] || homeTeam || 'HOME').trim();
  const away = String(fixture?.[8] || fixture?.[3] || awayTeam || 'AWAY').trim();

  return {
    matchNo: String(matchNo || fixture?.[0] || '-').trim(),
    oldScore,
    newScore: `${payload.hg}-${payload.ag}`,
    fixtureLine: `\`${home}\` ${safeEmoji(E.vs, '⚔️')} \`${away}\``,
    home,
    away,
    playedStatus: `Home: ${payload.homePlayed === null ? 'No change' : payload.homePlayed ? 'Yes' : 'No'} • Away: ${payload.awayPlayed === null ? 'No change' : payload.awayPlayed ? 'Yes' : 'No'}`
  };
}

function buildEditPreviewDescription(summary) {
  return (
    `⚠️ **Confirm Result Correction**\n` +
    `Review the corrected match data before saving it to Fixtures and Matches_Entry.\n\n` +
    `📌 **Match:** ${summary.matchNo}\n` +
    `${safeEmoji(E.vs, '⚔️')} **Fixture:** ${summary.fixtureLine}\n` +
    `📉 **Old Score:** ${summary.oldScore}\n` +
    `📈 **New Score:** ${summary.newScore}\n` +
    `✅ **Played Status:** ${summary.playedStatus}`
  );
}

function buildEditSuccessDescription(summary, resultText, liveStatus) {
  return (
    `✏️ **Result Corrected Successfully**\n` +
    `The saved result was updated in both Fixtures and Matches_Entry.\n\n` +
    `📌 **Match:** ${summary.matchNo}\n` +
    `${safeEmoji(E.vs, '⚔️')} **Fixture:** ${summary.fixtureLine}\n` +
    `📉 **Old Score:** ${summary.oldScore}\n` +
    `📈 **New Score:** ${summary.newScore}\n` +
    `🏷️ **Result Code:** ${resultText}\n` +
    `🏆 **Live Standings:** ${liveStatus}`
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('editresult')
    .setDescription('Correct an already submitted match result')
    .addStringOption(opt =>
      opt.setName('match').setDescription('Which played match to edit').setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName('homegoals').setDescription('Corrected home goals').setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName('awaygoals').setDescription('Corrected away goals').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('scorers').setDescription('Corrected scorers separated by commas').setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('assists').setDescription('Corrected assists separated by commas').setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('yellow').setDescription('Corrected yellow cards separated by commas').setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('red').setDescription('Corrected red cards separated by commas').setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('mvp').setDescription('Corrected MVP player').setRequired(false)
    )
    .addIntegerOption(opt =>
      opt.setName('homesaves').setDescription('Corrected Home Saves').setRequired(false).setMinValue(0)
    )
    .addIntegerOption(opt =>
      opt.setName('awaysaves').setDescription('Corrected Away Saves').setRequired(false).setMinValue(0)
    )
    .addStringOption(opt =>
      opt.setName('hometackles').setDescription('Corrected Home Tackles players, repeat names for counts').setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('awaytackles').setDescription('Corrected Away Tackles players, repeat names for counts').setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('homeinterceptions').setDescription('Corrected Home Interceptions players, repeat names for counts').setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('awayinterceptions').setDescription('Corrected Away Interceptions players, repeat names for counts').setRequired(false)
    )
    .addBooleanOption(opt =>
      opt.setName('homeplayed').setDescription('Did home team play this match?').setRequired(false)
    )
    .addBooleanOption(opt =>
      opt.setName('awayplayed').setDescription('Did away team play this match?').setRequired(false)
    ),

  async execute(interaction) {
    if (!isOwner(interaction)) {
      return { content: '🚫 Owner only command.' };
    }

    const targetMatch = String(interaction.options.getString('match') || '').trim();

    const payload = {
      hg: interaction.options.getInteger('homegoals'),
      ag: interaction.options.getInteger('awaygoals'),
      scorersRaw: interaction.options.getString('scorers') || '',
      assistsRaw: interaction.options.getString('assists') || '',
      yellowRaw: interaction.options.getString('yellow') || '',
      redRaw: interaction.options.getString('red') || '',
      mvpRaw: interaction.options.getString('mvp') || '',
      saves1: interaction.options.getInteger('homesaves') || 0,
      saves2: interaction.options.getInteger('awaysaves') || 0,
      tackles1Raw: interaction.options.getString('hometackles') || '',
      tackles2Raw: interaction.options.getString('awaytackles') || '',
      interceptions1Raw: interaction.options.getString('homeinterceptions') || '',
      interceptions2Raw: interaction.options.getString('awayinterceptions') || '',
      homePlayed: interaction.options.getBoolean('homeplayed'),
      awayPlayed: interaction.options.getBoolean('awayplayed')
    };

    const fixtures = await getData('Fixtures!A:I');
    const played = fixtures
      .slice(1)
      .map((row, index) => ({ row, index }))
      .filter(item => item.row[0] && hasScore(item.row));

    if (!played.length) {
      return { content: '❌ No played matches found to edit.' };
    }

    const selected = played.find(item => String(item.row[0]).trim() === targetMatch);

    if (!selected) {
      return { content: `❌ Match **${targetMatch}** was not found among played matches.` };
    }

    const fixture = selected.row;
    const teams = await getData('Teams!A:F');
    const homeShort = fixture[7] || '';
    const awayShort = fixture[8] || '';
    const homeRow = teams.find(t => normalize(t[2]) === normalize(homeShort));
    const awayRow = teams.find(t => normalize(t[2]) === normalize(awayShort));
    const homePlayers = homeRow?.[1] || '';
    const awayPlayers = awayRow?.[1] || '';

    const previewScorers = preserveExplicitPrefixes(
      payload.scorersRaw,
      buildMixedPrefixList(payload.scorersRaw, homePlayers, awayPlayers, homeShort, awayShort),
      homePlayers,
      awayPlayers,
      homeShort,
      awayShort
    );
    const previewAssists = preserveExplicitPrefixes(
      payload.assistsRaw,
      buildMixedPrefixList(payload.assistsRaw, homePlayers, awayPlayers, homeShort, awayShort),
      homePlayers,
      awayPlayers,
      homeShort,
      awayShort
    );
    const previewYellow = preserveExplicitPrefixes(
      payload.yellowRaw,
      buildMixedPrefixList(payload.yellowRaw, homePlayers, awayPlayers, homeShort, awayShort),
      homePlayers,
      awayPlayers,
      homeShort,
      awayShort
    );
    const previewRed = preserveExplicitPrefixes(
      payload.redRaw,
      buildMixedPrefixList(payload.redRaw, homePlayers, awayPlayers, homeShort, awayShort),
      homePlayers,
      awayPlayers,
      homeShort,
      awayShort
    );
    const previewMvp = preserveExplicitPrefixes(
      payload.mvpRaw,
      buildMixedPrefixList(payload.mvpRaw, homePlayers, awayPlayers, homeShort, awayShort),
      homePlayers,
      awayPlayers,
      homeShort,
      awayShort
    );
    const previewTackles1 = preserveExplicitPrefixes(
      payload.tackles1Raw,
      buildMixedPrefixList(payload.tackles1Raw, homePlayers, '', homeShort, ''),
      homePlayers,
      '',
      homeShort,
      ''
    );
    const previewTackles2 = preserveExplicitPrefixes(
      payload.tackles2Raw,
      buildMixedPrefixList(payload.tackles2Raw, '', awayPlayers, '', awayShort),
      '',
      awayPlayers,
      '',
      awayShort
    );
    const previewInterceptions1 = preserveExplicitPrefixes(
      payload.interceptions1Raw,
      buildMixedPrefixList(payload.interceptions1Raw, homePlayers, '', homeShort, ''),
      homePlayers,
      '',
      homeShort,
      ''
    );
    const previewInterceptions2 = preserveExplicitPrefixes(
      payload.interceptions2Raw,
      buildMixedPrefixList(payload.interceptions2Raw, '', awayPlayers, '', awayShort),
      '',
      awayPlayers,
      '',
      awayShort
    );
    const previewHomePlayed = payload.homePlayed === null ? 'No change' : payload.homePlayed ? 'Yes' : 'No';
    const previewAwayPlayed = payload.awayPlayed === null ? 'No change' : payload.awayPlayed ? 'Yes' : 'No';

    pendingEdits.set(interaction.user.id, {
      payload,
      fixtureIndex: selected.index,
      previewScorers,
      previewAssists,
      previewYellow,
      previewRed,
      previewMvp,
      previewTackles1,
      previewTackles2,
      previewInterceptions1,
      previewInterceptions2,
      previewHomePlayed,
      previewAwayPlayed,
      createdAt: Date.now()
    });

    const oldScore = `${selected.row[4] || 0}-${selected.row[5] || 0}`;
    const summary = buildEditResultSummary(targetMatch, oldScore, payload, selected.row, homeRow?.[0] || selected.row[2], awayRow?.[0] || selected.row[3]);
    const newScore = `${payload.hg}-${payload.ag}`;

    const embed = new EmbedBuilder()
      .setTitle('⚠️ Confirm Result Correction')
      .setDescription(buildEditPreviewDescription(summary))
      .addFields(
        { name: '🎯 New Scorers', value: previewScorers || 'None', inline: false },
        { name: '🅰️ New Assists', value: previewAssists || 'None', inline: false },
        { name: '🟨 New Yellow', value: previewYellow || 'None', inline: false },
        { name: '🟥 New Red', value: previewRed || 'None', inline: false },
        { name: '🏅 New MVP', value: previewMvp || 'None', inline: false },
        { name: '🧤 New Saves', value: `**${homeShort || homeRow?.[0] || fixture[2]}:** ${payload.saves1}\n**${awayShort || awayRow?.[0] || fixture[3]}:** ${payload.saves2}`, inline: false },
        { name: '🛡️ Home Tackles / Away Tackles', value: `**Home Tackles — ${homeShort || homeRow?.[0] || fixture[2]} (${repeatedCount(previewTackles1)}):**\n${compactCountList(previewTackles1)}\n\n**Away Tackles — ${awayShort || awayRow?.[0] || fixture[3]} (${repeatedCount(previewTackles2)}):**\n${compactCountList(previewTackles2)}`, inline: false },
        { name: '🧠 Home Interceptions / Away Interceptions', value: `**Home Interceptions — ${homeShort || homeRow?.[0] || fixture[2]} (${repeatedCount(previewInterceptions1)}):**\n${compactCountList(previewInterceptions1)}\n\n**Away Interceptions — ${awayShort || awayRow?.[0] || fixture[3]} (${repeatedCount(previewInterceptions2)}):**\n${compactCountList(previewInterceptions2)}`, inline: false },
        { name: '✅ Played Status', value: `Home Played: **${previewHomePlayed}**\nAway Played: **${previewAwayPlayed}**`, inline: false }
      )
      .setColor(0xE67E22)
      .setFooter({ text: 'Edit Result • Confirm to overwrite saved match data' });

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`editresult_confirm_${selected.index}`)
        .setLabel('✅ Yes, Correct')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('editresult_cancel_keep')
        .setLabel('❌ Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

    return {
      embeds: [embed],
      components: [buttons]
    };
  },

  async selectHandler(interaction) {
    if (!isOwner(interaction)) {
      return { content: '🚫 Owner only command.', components: [] };
    }

    const pending = pendingEdits.get(interaction.user.id);
    if (!pending) {
      return { content: '❌ Edit expired. Run /editresult again.', components: [] };
    }

    const fixtures = await getData('Fixtures!A:I');
    const fixtureRows = fixtures.slice(1);
    const fixtureIndex = Number(interaction.values[0]);
    const fixture = Number.isInteger(fixtureIndex) ? fixtureRows[fixtureIndex] : null;

    if (!fixture || !fixture[0]) {
      return { content: '❌ Match not found.', components: [] };
    }

    const p = pending.payload;
    const oldScore = `${fixture[4] || 0}-${fixture[5] || 0}`;
    const newScore = `${p.hg}-${p.ag}`;
    const previewHomePlayed = p.homePlayed === null ? 'No change' : p.homePlayed ? 'Yes' : 'No';
    const previewAwayPlayed = p.awayPlayed === null ? 'No change' : p.awayPlayed ? 'Yes' : 'No';
    const summary = buildEditResultSummary(fixture[0], oldScore, p, fixture, fixture[2], fixture[3]);

    const embed = new EmbedBuilder()
      .setTitle('⚠️ Confirm Result Correction')
      .setDescription(buildEditPreviewDescription(summary))
      .addFields(
        { name: 'New Scorers', value: p.scorersRaw || 'None', inline: false },
        { name: 'New Assists', value: p.assistsRaw || 'None', inline: false },
        { name: 'New Cards/MVP', value: `YC: ${p.yellowRaw || 'None'}\nRC: ${p.redRaw || 'None'}\nMVP: ${p.mvpRaw || 'None'}`, inline: false },
        {
          name: 'New Defensive Stats',
          value:
            `Home Saves / Away Saves: ${p.saves1}-${p.saves2}\n` +
            `Home Tackles: ${p.tackles1Raw ? `${compactCountList(p.tackles1Raw)} | Total ${repeatedCount(p.tackles1Raw)}` : 'None'}\n` +
            `Away Tackles: ${p.tackles2Raw ? `${compactCountList(p.tackles2Raw)} | Total ${repeatedCount(p.tackles2Raw)}` : 'None'}\n` +
            `Home Interceptions: ${p.interceptions1Raw ? `${compactCountList(p.interceptions1Raw)} | Total ${repeatedCount(p.interceptions1Raw)}` : 'None'}\n` +
            `Away Interceptions: ${p.interceptions2Raw ? `${compactCountList(p.interceptions2Raw)} | Total ${repeatedCount(p.interceptions2Raw)}` : 'None'}`,
          inline: false
        },
        { name: 'Played Status', value: `Home Played: **${previewHomePlayed}**\nAway Played: **${previewAwayPlayed}**`, inline: false }
      )
      .setColor(0xE67E22)
      .setFooter({ text: 'Edit Result • Confirm to overwrite saved match data' });

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`editresult_confirm_${fixtureIndex}`)
        .setLabel('✅ Yes, Correct')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('editresult_cancel_keep')
        .setLabel('❌ Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

    return {
      embeds: [embed],
      components: [buttons]
    };
  },

  async buttonHandler(interaction, action, value) {
    if (!isOwner(interaction)) {
      return { content: '🚫 Owner only command.', components: [] };
    }

    if (action === 'cancel') {
      pendingEdits.delete(interaction.user.id);
      return {
        embeds: [
          new EmbedBuilder()
            .setTitle('❎ Result Correction Cancelled')
            .setDescription('No result was changed.')
            .setColor(0x95A5A6)
        ],
        components: []
      };
    }

    const pending = pendingEdits.get(interaction.user.id);
    if (!pending) {
      return { content: '❌ Edit expired. Run /editresult again.', components: [] };
    }

    const p = pending.payload;
    const fixtureIndex = Number.isFinite(Number(pending.fixtureIndex)) ? Number(pending.fixtureIndex) : Number(value);

    const fixtures = await getData('Fixtures!A:I');
    const fixtureRows = fixtures.slice(1);
    const fixture = Number.isInteger(fixtureIndex) ? fixtureRows[fixtureIndex] : null;

    if (!fixture || !fixture[0]) {
      return { content: '❌ Match not found.', components: [] };
    }

    const teams = await getData('Teams!A:F');
    const homeShort = fixture[7] || '';
    const awayShort = fixture[8] || '';
    const homeRow = teams.find(t => normalize(t[2]) === normalize(homeShort));
    const awayRow = teams.find(t => normalize(t[2]) === normalize(awayShort));

    const homeTeam = homeRow?.[0] || fixture[2] || 'Unknown';
    const awayTeam = awayRow?.[0] || fixture[3] || 'Unknown';
    const homePlayers = homeRow?.[1] || '';
    const awayPlayers = awayRow?.[1] || '';

    const scorers = preserveExplicitPrefixes(
      p.scorersRaw,
      buildMixedPrefixList(p.scorersRaw, homePlayers, awayPlayers, homeShort, awayShort),
      homePlayers,
      awayPlayers,
      homeShort,
      awayShort
    );
    const assists = preserveExplicitPrefixes(
      p.assistsRaw,
      buildMixedPrefixList(p.assistsRaw, homePlayers, awayPlayers, homeShort, awayShort),
      homePlayers,
      awayPlayers,
      homeShort,
      awayShort
    );
    const yellow = preserveExplicitPrefixes(
      p.yellowRaw,
      buildMixedPrefixList(p.yellowRaw, homePlayers, awayPlayers, homeShort, awayShort),
      homePlayers,
      awayPlayers,
      homeShort,
      awayShort
    );
    const red = preserveExplicitPrefixes(
      p.redRaw,
      buildMixedPrefixList(p.redRaw, homePlayers, awayPlayers, homeShort, awayShort),
      homePlayers,
      awayPlayers,
      homeShort,
      awayShort
    );
    const mvp = preserveExplicitPrefixes(
      p.mvpRaw,
      buildMixedPrefixList(p.mvpRaw, homePlayers, awayPlayers, homeShort, awayShort),
      homePlayers,
      awayPlayers,
      homeShort,
      awayShort
    );
    const tackles1 = preserveExplicitPrefixes(
      p.tackles1Raw,
      buildMixedPrefixList(p.tackles1Raw, homePlayers, '', homeShort, ''),
      homePlayers,
      '',
      homeShort,
      ''
    );
    const tackles2 = preserveExplicitPrefixes(
      p.tackles2Raw,
      buildMixedPrefixList(p.tackles2Raw, '', awayPlayers, '', awayShort),
      '',
      awayPlayers,
      '',
      awayShort
    );
    const interceptions1 = preserveExplicitPrefixes(
      p.interceptions1Raw,
      buildMixedPrefixList(p.interceptions1Raw, homePlayers, '', homeShort, ''),
      homePlayers,
      '',
      homeShort,
      ''
    );
    const interceptions2 = preserveExplicitPrefixes(
      p.interceptions2Raw,
      buildMixedPrefixList(p.interceptions2Raw, '', awayPlayers, '', awayShort),
      '',
      awayPlayers,
      '',
      awayShort
    );
    const saves1 = p.saves1 || 0;
    const saves2 = p.saves2 || 0;

    const matchNo = fixture[0];
    const oldScore = `${fixture[4] || 0}-${fixture[5] || 0}`;
    const resultText = p.hg > p.ag ? 'H' : p.hg < p.ag ? 'A' : 'D';
    const summary = buildEditResultSummary(matchNo, oldScore, p, fixture, homeTeam, awayTeam);

    await interaction.message.edit({
      embeds: [
        new EmbedBuilder()
          .setTitle('⏳ Correcting Result...')
          .setDescription(`Updating **${matchNo}** to ${homeShort || homeTeam} ${p.hg}-${p.ag} ${awayShort || awayTeam}`)
          .setColor(0xE67E22)
      ],
      components: []
    });

    fixtureRows[fixtureIndex][4] = p.hg;
    fixtureRows[fixtureIndex][5] = p.ag;
    fixtureRows[fixtureIndex][6] = resultText;
    await updateData('Fixtures!A2:I', fixtureRows);

    const matches = await getData('Matches_Entry!A:R');
    const matchRows = matches.slice(1);
    const entryIndex = [...matchRows]
      .map((row, index) => ({ row, index }))
      .reverse()
      .find(item => String(item.row[0]) === String(matchNo))?.index;

    if (entryIndex !== undefined) {
      const existingRow = matchRows[entryIndex] || [];
      while (existingRow.length < 18) existingRow.push('');

      existingRow[0] = matchNo;
      existingRow[1] = homeTeam;
      existingRow[2] = awayTeam;
      existingRow[3] = p.hg;
      existingRow[4] = p.ag;
      existingRow[5] = scorers;
      existingRow[6] = assists;
      existingRow[7] = yellow;
      existingRow[8] = red;
      existingRow[9] = mvp;
      existingRow[10] = tackles1;
      existingRow[11] = tackles2;
      existingRow[12] = interceptions1;
      existingRow[13] = interceptions2;
      existingRow[14] = saves1;
      existingRow[15] = saves2;

      if (p.homePlayed !== null) existingRow[16] = p.homePlayed ? 'Yes' : 'No';
      if (p.awayPlayed !== null) existingRow[17] = p.awayPlayed ? 'Yes' : 'No';

      matchRows[entryIndex] = existingRow;
      await updateData('Matches_Entry!A2:R', matchRows);
    }

    invalidateSheetCache([
      'Fixtures!',
      'Matches_Entry!',
      'Ranking!',
      'Standings!',
      'Fair_Play!',
      'Suspension!',
      'Team_Stats!'
    ]);

    let liveStatus = 'Not refreshed';
    try {
      const liveResult = await refreshLiveStandings(interaction.client, interaction.guild.id, 'coop_league');
      liveStatus = liveResult.ok ? '✅ Updated' : `⚠️ ${liveResult.reason}`;
    } catch {
      liveStatus = '⚠️ Live standings refresh failed';
    }

    pendingEdits.delete(interaction.user.id);

    sendAuditLog(interaction, {
      title: '✏️ Result Corrected',
      description: `**${matchNo}** | ${homeShort || homeTeam} ${oldScore} ${awayShort || awayTeam} → ${p.hg}-${p.ag} (${resultText})`,
      color: 0x3498DB,
      fields: [
        { name: '⚽ Scorers', value: scorers || 'None', inline: false },
        { name: '🎯 Assists', value: assists || 'None', inline: false },
        { name: '🧤 Saves', value: `**${homeShort || homeTeam}:** ${saves1}\n**${awayShort || awayTeam}:** ${saves2}`, inline: false },
        { name: '🛡️ Tackles', value: `**Home Tackles — ${homeShort || homeTeam} (${repeatedCount(tackles1)}):**\n${compactCountList(tackles1)}\n\n**Away Tackles — ${awayShort || awayTeam} (${repeatedCount(tackles2)}):**\n${compactCountList(tackles2)}`, inline: false },
        { name: '🧠 Interceptions', value: `**Home Interceptions — ${homeShort || homeTeam} (${repeatedCount(interceptions1)}):**\n${compactCountList(interceptions1)}\n\n**Away Interceptions — ${awayShort || awayTeam} (${repeatedCount(interceptions2)}):**\n${compactCountList(interceptions2)}`, inline: false },
        { name: '🏆 COOP Live Standings', value: liveStatus, inline: false }
      ]
    });

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle('✏️ Result Corrected')
          .setDescription(buildEditSuccessDescription(summary, resultText, liveStatus))
          .addFields(
            { name: '⚽ Scorers', value: scorers || 'None', inline: false },
            { name: '🎯 Assists', value: assists || 'None', inline: false },
            { name: '🟨 Yellow', value: yellow || 'None', inline: false },
            { name: '🟥 Red', value: red || 'None', inline: false },
            { name: '🏅 MVP', value: mvp || 'None', inline: false },
            { name: '🧤 Saves', value: `**${homeShort || homeTeam}:** ${saves1}\n**${awayShort || awayTeam}:** ${saves2}`, inline: false },
            { name: '🛡️ Home Tackles / Away Tackles', value: `**Home Tackles — ${homeShort || homeTeam} (${repeatedCount(tackles1)}):**\n${compactCountList(tackles1)}\n\n**Away Tackles — ${awayShort || awayTeam} (${repeatedCount(tackles2)}):**\n${compactCountList(tackles2)}`, inline: false },
            { name: '🧠 Home Interceptions / Away Interceptions', value: `**Home Interceptions — ${homeShort || homeTeam} (${repeatedCount(interceptions1)}):**\n${compactCountList(interceptions1)}\n\n**Away Interceptions — ${awayShort || awayTeam} (${repeatedCount(interceptions2)}):**\n${compactCountList(interceptions2)}`, inline: false },
            { name: '✅ Played Status', value: `Home Played: **${p.homePlayed === null ? 'No change' : p.homePlayed ? 'Yes' : 'No'}**\nAway Played: **${p.awayPlayed === null ? 'No change' : p.awayPlayed ? 'Yes' : 'No'}**`, inline: false },
            { name: '🏆 COOP Live Standings', value: liveStatus, inline: false }
          )
          .setColor(0x2ECC71)
          .setFooter({ text: 'Edit Result • Saved to Fixtures and Matches_Entry' })
      ],
      components: []
    };
  }
};
