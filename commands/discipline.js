const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { cachedGetData } = require('../utils/helpers');
// Suspension service no longer used.
const E = require('../utils/emojis');

const PER_PAGE = 5;

const padEnd = (value, len) => String(value ?? '').padEnd(len, ' ');
const padStart = (value, len) => String(value ?? '').padStart(len, ' ');
const shorten = (value, len) => {
  const str = String(value ?? '');
  return str.length > len ? `${str.slice(0, len - 1)}…` : str;
};

const safeEmoji = (value, fallback = '') => value || fallback;

function clean(value) {
  return String(value || '').trim();
}

function getCompetitionConfig(key) {
  const normalized = clean(key || 'league').toLowerCase();

  if (normalized === 'fa') {
    return {
      key: 'fa',
      label: 'FA Cup',
      rankingYellowRange: 'FA_Cup_Coop_Ranking!H:I',
      rankingRedRange: 'FA_Cup_Coop_Ranking!K:L',
      fairPlayRange: 'Fair_Play!H:L',
      footerText: 'FA Cup'
    };
  }

  if (normalized === 'carabao') {
    return {
      key: 'carabao',
      label: 'Carabao Cup',
      rankingYellowRange: 'Carabao_Coop_Ranking!H:I',
      rankingRedRange: 'Carabao_Coop_Ranking!K:L',
      fairPlayRange: 'Fair_Play!H:L',
      footerText: 'Carabao Cup'
    };
  }

  if (normalized === 'ucl') {
    return {
      key: 'ucl',
      label: 'UCL',
      rankingYellowRange: 'UCL_Coop_Ranking!H:I',
      rankingRedRange: 'UCL_Coop_Ranking!K:L',
      fairPlayRange: 'Fair_Play!H:L',
      footerText: 'UCL'
    };
  }

  return {
    key: 'league',
    label: 'League',
    rankingYellowRange: 'Ranking!H:I',
    rankingRedRange: 'Ranking!K:L',
    fairPlayRange: 'Fair_Play!A:E',
    footerText: 'Coop league'
  };
}


module.exports = {
  data: new SlashCommandBuilder()
    .setName('discipline')
    .setDescription('View coop league cards or fair play table')
    .addStringOption(opt =>
      opt
        .setName('type')
        .setDescription('Which discipline view to show')
        .setRequired(true)
        .addChoices(
          { name: 'Cards', value: 'cards' },
          { name: 'Fair Play', value: 'fairplay' }
        )
    )
    .addStringOption(opt =>
      opt
        .setName('competition')
        .setDescription('Competition to view discipline for')
        .setRequired(false)
        .addChoices(
          { name: 'League', value: 'league' },
          { name: 'FA Cup', value: 'fa' },
          { name: 'Carabao Cup', value: 'carabao' },
          { name: 'UCL', value: 'ucl' }
        )
    ),

  async execute(interaction) {
    const type = interaction.options.getString('type');
    const competitionKey = interaction.options.getString('competition') || 'league';
    const userId = interaction.user.id;

    if (type === 'cards') return buildCardsPage(0, competitionKey, userId);
    if (type === 'fairplay') return buildFairPlay(competitionKey, userId);

    return { content: '❌ Invalid discipline type.' };
  },

  async buttonHandler(interaction, section, action, page) {
    const ownerId = interaction.message?.interactionMetadata?.user?.id
      || interaction.message?.interaction?.user?.id;

    if (ownerId && interaction.user.id !== ownerId) {
      return {
        content: '❌ Only the user who used this command can use these buttons.',
        ephemeral: true
      };
    }

    let newPage = 0;
    let competitionKey = 'league';
    let direction = 'next';

    const raw = String(action || '');
    const match = raw.match(/^__([^_]+)_(prev|next)_(\d+)/);

    if (match) {
      competitionKey = match[1];
      direction = match[2];
      newPage = parseInt(match[3], 10) || 0;
    }

    if (direction === 'prev') newPage--;
    if (direction === 'next') newPage++;

    if (section === 'cards') {
      return buildCardsPage(newPage, competitionKey);
    }

    return { content: '❌ Invalid discipline action.', components: [] };
  }
};

async function buildCardsPage(page, competitionKey = 'league', userId = null) {
  const competition = getCompetitionConfig(competitionKey);
  const yellow = await cachedGetData(competition.rankingYellowRange).catch(() => []);
  const red = await cachedGetData(competition.rankingRedRange).catch(() => []);

  const yRows = yellow.slice(2).filter(r => r[0] && r[1]);
  const rRows = red.slice(2).filter(r => r[0] && r[1]);

  const totalPages = Math.max(1, Math.ceil(Math.max(yRows.length, rRows.length) / PER_PAGE));
  page = Math.max(0, Math.min(page, totalPages - 1));

  const yPage = yRows.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  const rPage = rRows.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);

  const buildTable = (rows, label, offset) => {
    const header = ` # PLAYER         ${label}`;
    const body = rows.map((r, i) => {
      const rank = padStart(offset + i + 1, 2);
      const name = padEnd(shorten(r[0], 13), 13);
      const value = padStart(r[1], 3);
      return `${rank} ${name} ${value}`;
    }).join('\n');

    return `\`\`\`ini\n${header}\n${body || 'No data'}\n\`\`\``;
  };

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`discipline_cards__${competitionKey}_prev_${page}_${userId || '0'}`)
      .setLabel('◀ Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),

    new ButtonBuilder()
      .setCustomId(`discipline_cards__${competitionKey}_next_${page}_${userId || '0'}`)
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1)
  );

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`${safeEmoji(E.redCard, '🟥')} ${competition.label} Discipline Leaders`)
        .setDescription(
          `${competition.label} card leaders from player ranking data.\n` +
          `${competition.key === 'fa' || competition.key === 'carabao' ? 'Cup order: **R1 → QFQ → QF → SF → Final**.' : competition.key === 'ucl' ? 'UCL order: **GS → QF → SF → Final**.' : 'League order follows matchdays.'}`
        )
        .addFields(
          { name: `${safeEmoji(E.yellowCard, '🟨')} Yellow Cards`, value: buildTable(yPage, 'YC', page * PER_PAGE), inline: false },
          { name: `${safeEmoji(E.redCard, '🟥')} Red Cards`, value: buildTable(rPage, 'RC', page * PER_PAGE), inline: false },
          { name: `${safeEmoji(E.page || E.calendar, '📄')} Page`, value: `${page + 1}/${totalPages}`, inline: true },
          { name: `${safeEmoji(E.team, '👥')} Entries`, value: String(Math.max(yRows.length, rRows.length)), inline: true }
        )
        .setColor(0xE67E22)
        .setFooter({ text: `${competition.footerText} • Use buttons to view more card leaders` })
    ],
    components: [buttons]
  };
}

async function buildFairPlay(competitionKey = 'league', userId = null) {
  const competition = getCompetitionConfig(competitionKey);
  const fairplay = await cachedGetData(competition.fairPlayRange).catch(() => []);
  const teams = await cachedGetData('Teams!A:C');

  if (!Array.isArray(fairplay) || fairplay.length === 0) {
    return { content: `❌ No ${competition.label} fair play data found` };
  }

  const shortMap = {};
  teams.slice(1).forEach(row => {
    const teamName = row[0];
    const shortName = row[2];
    if (teamName && shortName) {
      shortMap[String(teamName).trim().toLowerCase()] = String(shortName).trim().toUpperCase();
    }
  });

  const rows = fairplay
    .slice(1)
    .filter(r => r[0] && String(r[0]).trim().toLowerCase() !== 'teams');

  const table = rows.map((r, i) => {
    const fullTeam = String(r[0] || '').trim().toLowerCase();
    const tm = padEnd(shortMap[fullTeam] || String(r[0] || '').slice(0, 6).toUpperCase() || 'N/A', 6);
    const yc = padStart(r[1] || 0, 2);
    const rc = padStart(r[2] || 0, 2);
    const pts = padStart(r[4] ?? r[3] ?? 0, 3);

    const line = `${padStart(i + 1, 2)} ${tm} ${yc} ${rc} ${pts}`;

    if (i < 3) return `+ ${line}`;
    if (i >= rows.length - 3) return `- ${line}`;
    return `  ${line}`;
  }).join('\n');

  const header = `   # TEAM   YC RC  PTS`;

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`${safeEmoji(E.fairPlay || E.fairplay, '🤝')} ${competition.label} Fair Play Table`)
        .setDescription(`\`\`\`diff\n${header}\n${table}\n\`\`\``)
        .addFields(
          { name: `${safeEmoji(E.team, '👥')} Teams`, value: String(rows.length), inline: true },
          { name: `${safeEmoji(E.info || E.calendar, '📌')} Rule`, value: 'Lower points is better', inline: true }
        )
        .setColor(0x2ECC71)
        .setFooter({ text: `${competition.footerText} • Team card tracking only • Lower is better` })
    ]
  };
}
