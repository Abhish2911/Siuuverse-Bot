const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const { loadHandFootballData } = require('./handfootball');
const { getActiveHFTournament } = require('./hfTournamentConfig');

const fontPath = path.join(__dirname, '../assets/fonts/DejaVuSansMono.ttf');
GlobalFonts.registerFromPath(fontPath, 'DejaVuSansMono');

const ROUND_ORDER = {
  'round 1': 1,
  'round 2': 2,
  'round of 16': 2,
  'quarter final': 3,
  'quarter finals': 3,
  'quarter-final': 3,
  'semi final': 4,
  'semi finals': 4,
  'semi-final': 4,
  final: 5
};

function clean(value) {
  return String(value || '').trim();
}

function normalizeRound(value) {
  return clean(value).toLowerCase().replace(/\s+/g, ' ');
}

function roundRank(value) {
  const normalized = normalizeRound(value);
  return ROUND_ORDER[normalized] || 50;
}

function parseHexColor(value, fallback = '#38bdf8') {
  const color = clean(value);
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function truncateText(ctx, value, width) {
  let text = clean(value) || 'TBD';
  if (ctx.measureText(text).width <= width) return text;
  while (text.length > 1 && ctx.measureText(`${text}...`).width > width) text = text.slice(0, -1);
  return `${text}...`;
}

function groupRounds(data) {
  const grouped = new Map();
  for (const fixture of data.fixtures || []) {
    const round = clean(fixture.round || fixture.stage || fixture.roundName);
    if (!round) continue;
    if (!grouped.has(round)) grouped.set(round, []);
    grouped.get(round).push(fixture);
  }
  return [...grouped.entries()]
    .sort((left, right) => roundRank(left[0]) - roundRank(right[0]) || left[0].localeCompare(right[0]))
    .map(([name, matches]) => ({ name, matches }));
}

function teamColor(data, name) {
  return parseHexColor(data.teams?.find(team => clean(team.team).toLowerCase() === clean(name).toLowerCase())?.color);
}

function tournamentTitle(data, fallback) {
  if (data?.leagueName) return data.leagueName;
  try {
    return getActiveHFTournament().leagueName || fallback;
  } catch {
    return fallback;
  }
}

function drawMatch(ctx, data, match, x, y, width, height) {
  const home = clean(match.home);
  const away = clean(match.away);
  const homeScore = match.homeGoals === '' || match.homeGoals === undefined ? '-' : String(match.homeGoals);
  const awayScore = match.awayGoals === '' || match.awayGoals === undefined ? '-' : String(match.awayGoals);
  const played = homeScore !== '-' && awayScore !== '-';

  ctx.fillStyle = '#111c44';
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 8);
  ctx.fill();
  ctx.fillStyle = teamColor(data, home);
  ctx.fillRect(x, y, 5, height / 2 - 1);
  ctx.fillStyle = teamColor(data, away);
  ctx.fillRect(x, y + height / 2 + 1, 5, height / 2 - 1);

  ctx.font = 'bold 13px DejaVuSansMono';
  ctx.fillStyle = '#f8fafc';
  ctx.fillText(truncateText(ctx, home, width - 65).toUpperCase(), x + 14, y + 24);
  ctx.fillText(truncateText(ctx, away, width - 65).toUpperCase(), x + 14, y + 60);
  ctx.textAlign = 'right';
  ctx.fillStyle = played ? '#00f5a0' : '#94a3b8';
  ctx.fillText(homeScore, x + width - 14, y + 24);
  ctx.fillText(awayScore, x + width - 14, y + 60);
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(x + 5, y + height / 2, width - 5, 1);
}

function buildBracket(data, rounds) {
  const width = Math.max(1200, 180 + rounds.length * 300);
  const maxMatches = Math.max(...rounds.map(round => round.matches.length), 1);
  const height = Math.max(760, 190 + maxMatches * 118);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, '#030712');
  background.addColorStop(0.5, '#0b1536');
  background.addColorStop(1, '#02050c');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  const cardX = 40;
  const cardY = 35;
  const cardWidth = width - 80;
  const cardHeight = height - 70;
  ctx.fillStyle = '#0e172f';
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardWidth, cardHeight, 18);
  ctx.fill();
  ctx.fillStyle = '#090f26';
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardWidth, 78, [18, 18, 0, 0]);
  ctx.fill();
  ctx.fillStyle = '#00f5a0';
  ctx.fillRect(cardX, cardY + 74, cardWidth, 4);

  const title = tournamentTitle(data, 'HAND FOOTBALL');
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 25px DejaVuSansMono';
  ctx.fillText(clean(title).toUpperCase(), cardX + 30, cardY + 46);
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 14px DejaVuSansMono';
  ctx.textAlign = 'right';
  ctx.fillText('KNOCKOUT STAGE', cardX + cardWidth - 30, cardY + 46);
  ctx.textAlign = 'left';

  const contentTop = cardY + 112;
  const contentHeight = cardHeight - 150;
  const gap = 38;
  const columnWidth = (cardWidth - 70 - gap * (rounds.length - 1)) / rounds.length;
  const centers = [];

  rounds.forEach((round, roundIndex) => {
    const x = cardX + 35 + roundIndex * (columnWidth + gap);
    const matches = round.matches;
    const slot = contentHeight / Math.max(matches.length, 1);
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.roundRect(x, contentTop - 34, columnWidth, 28, 6);
    ctx.fill();
    ctx.fillStyle = '#7dd3fc';
    ctx.font = 'bold 12px DejaVuSansMono';
    ctx.textAlign = 'center';
    ctx.fillText(round.name.toUpperCase(), x + columnWidth / 2, contentTop - 15);
    ctx.textAlign = 'left';

    centers[roundIndex] = [];
    matches.forEach((match, matchIndex) => {
      const centerY = contentTop + matchIndex * slot + slot / 2;
      drawMatch(ctx, data, match, x, centerY - 39, columnWidth, 78);
      centers[roundIndex].push({ left: x, right: x + columnWidth, y: centerY });
    });
  });

  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 2;
  for (let roundIndex = 0; roundIndex < centers.length - 1; roundIndex += 1) {
    centers[roundIndex].forEach((source, matchIndex) => {
      const target = centers[roundIndex + 1][Math.floor(matchIndex / 2)];
      if (!target) return;
      const middle = source.right + gap / 2;
      ctx.beginPath();
      ctx.moveTo(source.right, source.y);
      ctx.lineTo(middle, source.y);
      ctx.lineTo(middle, target.y);
      ctx.lineTo(target.left, target.y);
      ctx.stroke();
    });
  }

  ctx.fillStyle = '#64748b';
  ctx.font = 'bold 12px DejaVuSansMono';
  ctx.textAlign = 'right';
  const total = rounds.reduce((sum, round) => sum + round.matches.length, 0);
  const completed = rounds.reduce((sum, round) => sum + round.matches.filter(match => match.homeGoals !== '' && match.awayGoals !== '').length, 0);
  ctx.fillText(`Rounds: ${rounds.length} • Fixtures: ${total} • Completed: ${completed}`, cardX + cardWidth - 30, cardY + cardHeight - 25);
  return canvas.toBuffer('image/png');
}

async function buildHFKnockoutImage() {
  const data = await loadHandFootballData();
  return buildBracket(data, groupRounds(data));
}

module.exports = { buildHFKnockoutImage, groupRounds, buildBracket };
