const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const { loadHandFootballData, sameTeam } = require('./handfootball');
const { getActiveHFTournament } = require('./hfTournamentConfig');

const fontPath = path.join(__dirname, '../assets/fonts/DejaVuSansMono.ttf');
GlobalFonts.registerFromPath(fontPath, 'DejaVuSansMono');

function clean(value) {
  return String(value || '').trim();
}

function tournamentTitle(data, fallback) {
  if (data?.leagueName) return data.leagueName;
  try {
    return getActiveHFTournament().leagueName || fallback;
  } catch {
    return fallback;
  }
}

function groupFixtures(data) {
  const groups = new Map();
  for (const fixture of data.fixtures || []) {
    const group = clean(fixture.group);
    if (!group) continue;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(fixture);
  }
  return groups;
}

function getRows(data, fixtures) {
  const names = new Map();
  fixtures.forEach(fixture => {
    [fixture.home, fixture.away].forEach(team => {
      if (team) names.set(team, { team, played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, points: 0 });
    });
  });
  fixtures.forEach(fixture => {
    if (fixture.homeGoals === '' || fixture.awayGoals === '' || fixture.homeGoals === undefined || fixture.awayGoals === undefined) return;
    const home = names.get(fixture.home);
    const away = names.get(fixture.away);
    if (!home || !away) return;
    home.played += 1;
    away.played += 1;
    home.gf += Number(fixture.homeGoals) || 0;
    home.ga += Number(fixture.awayGoals) || 0;
    away.gf += Number(fixture.awayGoals) || 0;
    away.ga += Number(fixture.homeGoals) || 0;
    if (fixture.homeGoals > fixture.awayGoals) {
      home.wins += 1;
      away.losses += 1;
      home.points += 3;
    } else if (fixture.homeGoals < fixture.awayGoals) {
      away.wins += 1;
      home.losses += 1;
      away.points += 3;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.points += 1;
      away.points += 1;
    }
  });
  return [...names.values()].sort((left, right) => right.points - left.points || (right.gf - right.ga) - (left.gf - left.ga) || right.gf - left.gf || left.team.localeCompare(right.team));
}

function drawGroup(ctx, data, name, fixtures, x, y, width) {
  const rows = getRows(data, fixtures);
  const rowHeight = 34;
  const headerHeight = 34;
  const tableHeight = headerHeight + Math.max(rows.length, 1) * rowHeight;
  ctx.fillStyle = '#0e172f';
  ctx.beginPath();
  ctx.roundRect(x, y, width, tableHeight + 44, 12);
  ctx.fill();
  ctx.fillStyle = '#111936';
  ctx.beginPath();
  ctx.roundRect(x, y, width, 42, [12, 12, 0, 0]);
  ctx.fill();
  ctx.fillStyle = '#7dd3fc';
  ctx.font = 'bold 15px DejaVuSansMono';
  ctx.fillText(`GROUP ${name}`, x + 16, y + 27);
  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 11px DejaVuSansMono';
  ctx.fillText('TEAM', x + 16, y + 65);
  ctx.textAlign = 'right';
  ['P', 'W', 'D', 'L', 'GD', 'PTS'].forEach((label, index) => ctx.fillText(label, x + width - 22 - index * 40, y + 65));
  ctx.textAlign = 'left';

  rows.forEach((row, index) => {
    const rowY = y + headerHeight + 42 + index * rowHeight;
    ctx.fillStyle = index < 2 ? 'rgba(16,185,129,0.14)' : 'rgba(255,255,255,0.04)';
    ctx.fillRect(x + 8, rowY - 22, width - 16, rowHeight - 2);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 12px DejaVuSansMono';
    ctx.fillText(`${index + 1}. ${row.team.slice(0, 24)}`, x + 16, rowY);
    const values = [row.played, row.wins, row.draws, row.losses, row.gf - row.ga, row.points];
    ctx.textAlign = 'right';
    values.forEach((value, valueIndex) => ctx.fillText(String(value), x + width - 22 - valueIndex * 40, rowY));
    ctx.textAlign = 'left';
  });
}

async function buildHFGroupStageImage() {
  const data = await loadHandFootballData();
  const groups = groupFixtures(data);
  const entries = [...groups.entries()];
  const columns = Math.min(2, Math.max(entries.length, 1));
  const rows = Math.ceil(Math.max(entries.length, 1) / columns);
  const canvasWidth = columns === 2 ? 1400 : 820;
  const canvasHeight = Math.max(700, 180 + rows * 360);
  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d');
  const background = ctx.createLinearGradient(0, 0, canvasWidth, canvasHeight);
  background.addColorStop(0, '#030712');
  background.addColorStop(0.5, '#0b1536');
  background.addColorStop(1, '#02050c');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.fillStyle = '#0e172f';
  ctx.beginPath();
  ctx.roundRect(35, 30, canvasWidth - 70, canvasHeight - 60, 18);
  ctx.fill();
  ctx.fillStyle = '#090f26';
  ctx.beginPath();
  ctx.roundRect(35, 30, canvasWidth - 70, 78, [18, 18, 0, 0]);
  ctx.fill();
  ctx.fillStyle = '#00f5a0';
  ctx.fillRect(35, 104, canvasWidth - 70, 4);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 25px DejaVuSansMono';
  ctx.fillText(clean(tournamentTitle(data, 'HAND FOOTBALL')).toUpperCase(), 65, 77);
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 14px DejaVuSansMono';
  ctx.textAlign = 'right';
  ctx.fillText('GROUP STAGE', canvasWidth - 65, 77);
  ctx.textAlign = 'left';

  const gap = 28;
  const tableWidth = (canvasWidth - 70 - gap * (columns - 1) - 40) / columns;
  entries.forEach(([name, fixtures], index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    drawGroup(ctx, data, name, fixtures, 55 + column * (tableWidth + gap), 155 + row * 350, tableWidth);
  });
  return canvas.toBuffer('image/png');
}

module.exports = { buildHFGroupStageImage, groupFixtures, getRows };
