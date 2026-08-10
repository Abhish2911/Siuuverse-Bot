const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const {
  getTeamRecord,
  loadHandFootballData,
  sameTeam
} = require('../utils/handfootball');

const dejavuFontPath = path.join(__dirname, '../assets/fonts/DejaVuSansMono.ttf');
GlobalFonts.registerFromPath(dejavuFontPath, 'DejaVuSansMono');

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}

function parseHexColor(value, fallback = '#cbd5e1') {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function getShortName(teamName) {
  const words = String(teamName || '')
    .replace(/[^a-z0-9 ]/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!words.length) return '---';
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();

  return words
    .map(word => word[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();
}

function getAllTeamNames(data) {
  return [...new Set([
    ...data.teams.map(team => team.team),
    ...data.players.map(player => player.team),
    ...data.fixtures.flatMap(fixture => [fixture.home, fixture.away])
  ].filter(Boolean))];
}

function getTeamMeta(data, teamName) {
  return data.teams.find(team => sameTeam(team.team, teamName)) || {
    team: teamName,
    color: ''
  };
}

function getTeamForm(fixtures, teamName) {
  return fixtures
    .filter(fixture => fixture.played && (sameTeam(fixture.home, teamName) || sameTeam(fixture.away, teamName)))
    .map(fixture => {
      const isHome = sameTeam(fixture.home, teamName);
      const goalsFor = Number(isHome ? fixture.homeGoals : fixture.awayGoals) || 0;
      const goalsAgainst = Number(isHome ? fixture.awayGoals : fixture.homeGoals) || 0;

      if (goalsFor > goalsAgainst) return 'W';
      if (goalsFor < goalsAgainst) return 'L';
      return 'D';
    })
    .slice(-5);
}

function truncateText(ctx, text, maxWidth) {
  const value = String(text || '');
  if (ctx.measureText(value).width <= maxWidth) return value;

  let output = value;
  while (output.length > 1 && ctx.measureText(`${output}...`).width > maxWidth) {
    output = output.slice(0, -1);
  }

  return `${output}...`;
}

function buildStandingsRows(data) {
  return getAllTeamNames(data)
    .map(teamName => {
      const record = getTeamRecord(data.fixtures, teamName);
      const goalDifference = record.goalsFor - record.goalsAgainst;
      const meta = getTeamMeta(data, teamName);

      return {
        name: teamName,
        short: getShortName(teamName),
        color: parseHexColor(meta.color),
        p: record.played,
        w: record.wins,
        d: record.draws,
        l: record.losses,
        gf: record.goalsFor,
        ga: record.goalsAgainst,
        gd: goalDifference,
        pts: record.points,
        form: getTeamForm(data.fixtures, teamName)
      };
    })
    .sort((left, right) => {
      if (right.pts !== left.pts) return right.pts - left.pts;
      if (right.gd !== left.gd) return right.gd - left.gd;
      if (right.gf !== left.gf) return right.gf - left.gf;
      return left.name.localeCompare(right.name);
    })
    .map((team, index) => ({
      ...team,
      rank: index + 1
    }));
}

async function buildHFStandingsImage() {
  const data = await loadHandFootballData();
  const rows = buildStandingsRows(data);
  const totalTeams = Math.max(rows.length, 1);
  const rowHeight = 44;
  const rowGap = 7;
  const canvasWidth = 1200;
  const canvasHeight = Math.max(780, 240 + totalTeams * (rowHeight + rowGap));
  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, canvasWidth, canvasHeight);
  bg.addColorStop(0, '#030712');
  bg.addColorStop(0.5, '#0b1536');
  bg.addColorStop(1, '#02050c');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.strokeStyle = 'rgba(0, 245, 160, 0.03)';
  ctx.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += 50) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  ctx.restore();

  ctx.globalAlpha = 0.06;
  ctx.fillStyle = '#00f5a0';
  ctx.beginPath();
  ctx.arc(1150, 200, 400, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3b82f6';
  ctx.beginPath();
  ctx.arc(50, 720, 420, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  const cardX = 60;
  const cardY = 60;
  const cardWidth = 1080;
  const cardHeight = canvasHeight - 120;
  const headerHeight = 80;

  ctx.fillStyle = '#f1f5f9';
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardWidth, cardHeight, 20);
  ctx.fill();

  ctx.fillStyle = '#090f26';
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardWidth, headerHeight, [20, 20, 0, 0]);
  ctx.fill();

  ctx.fillStyle = '#00f5a0';
  ctx.fillRect(cardX, cardY + headerHeight - 4, cardWidth, 4);

  const leagueName = process.env.HF_LEAGUE_NAME || 'HAND FOOTBALL LEAGUE';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 26px DejaVuSansMono';
  ctx.fillText(String(leagueName).toUpperCase(), cardX + 35, cardY + 46);

  ctx.fillStyle = 'rgba(0, 245, 160, 0.9)';
  ctx.font = 'bold 15px DejaVuSansMono';
  ctx.textAlign = 'right';
  ctx.fillText('LIVE STANDINGS', cardX + cardWidth - 35, cardY + 46);
  ctx.textAlign = 'left';

  const subHeaderY = cardY + headerHeight;
  ctx.fillStyle = '#111936';
  ctx.fillRect(cardX, subHeaderY, cardWidth, 45);

  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 12px DejaVuSansMono';
  ctx.fillText('RANK', cardX + 35, subHeaderY + 27);
  ctx.fillText('TEAM', cardX + 115, subHeaderY + 27);
  ctx.fillText('SHORT', cardX + 410, subHeaderY + 27);
  ctx.fillText('FORM HISTORY', cardX + 490, subHeaderY + 27);

  const colX = {
    p: cardX + 660,
    w: cardX + 710,
    d: cardX + 760,
    l: cardX + 810,
    gf: cardX + 860,
    ga: cardX + 910,
    gd: cardX + 960,
    pts: cardX + 1055
  };

  ctx.textAlign = 'right';
  ctx.fillText('P', colX.p, subHeaderY + 27);
  ctx.fillText('W', colX.w, subHeaderY + 27);
  ctx.fillText('D', colX.d, subHeaderY + 27);
  ctx.fillText('L', colX.l, subHeaderY + 27);
  ctx.fillText('GF', colX.gf, subHeaderY + 27);
  ctx.fillText('GA', colX.ga, subHeaderY + 27);
  ctx.fillText('GD', colX.gd, subHeaderY + 27);
  ctx.fillStyle = '#00f5a0';
  ctx.fillText('PTS', colX.pts - 10, subHeaderY + 27);
  ctx.textAlign = 'left';

  if (!rows.length) {
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 24px DejaVuSansMono';
    ctx.textAlign = 'center';
    ctx.fillText('NO HAND FOOTBALL TEAMS FOUND', cardX + cardWidth / 2, subHeaderY + 120);
    return canvas.toBuffer('image/png');
  }

  const startY = subHeaderY + 55;
  const bottomRankStart = Math.max(rows.length - 2, 1);

  for (const team of rows) {
    const y = startY + (team.rank - 1) * (rowHeight + rowGap);
    const isTop = team.rank <= Math.min(4, rows.length);
    const isBottom = rows.length >= 6 && team.rank >= bottomRankStart;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.04)';
    ctx.beginPath();
    ctx.roundRect(cardX + 2, y + 3, cardWidth - 4, rowHeight, 8);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(cardX, y, cardWidth, rowHeight, 8);
    ctx.fill();

    ctx.fillStyle = team.color;
    ctx.fillRect(cardX, y, 6, rowHeight);

    ctx.fillStyle = isTop ? '#d1fae5' : isBottom ? '#fee2e2' : '#f1f5f9';
    ctx.beginPath();
    ctx.arc(cardX + 44, y + 22, 13, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = isTop ? '#059669' : isBottom ? '#ef4444' : '#475569';
    ctx.font = 'bold 13px DejaVuSansMono';
    ctx.textAlign = 'center';
    ctx.fillText(String(team.rank), cardX + 44, y + 26);
    ctx.textAlign = 'left';

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 14px DejaVuSansMono';
    ctx.fillText(truncateText(ctx, team.name.toUpperCase(), 285), cardX + 78, y + 27);

    ctx.fillStyle = 'rgba(241, 245, 249, 0.8)';
    ctx.beginPath();
    ctx.roundRect(cardX + 404, y + 12, 50, 20, 4);
    ctx.fill();

    ctx.fillStyle = '#475569';
    ctx.font = 'bold 12px DejaVuSansMono';
    ctx.fillText(team.short || '---', cardX + 412, y + 26);

    ctx.fillStyle = '#f1f5f9';
    ctx.beginPath();
    ctx.roundRect(cardX + 484, y + 11, 114, 22, 11);
    ctx.fill();

    const form = team.form.length ? team.form : ['-', '-', '-', '-', '-'];
    for (let index = 0; index < form.length; index += 1) {
      const result = form[index];
      ctx.fillStyle = result === 'W'
        ? '#10b981'
        : result === 'D'
          ? '#f59e0b'
          : result === 'L'
            ? '#f43f5e'
            : '#cbd5e1';
      ctx.beginPath();
      ctx.arc(cardX + 497 + index * 22, y + 22, 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px DejaVuSansMono';
      ctx.textAlign = 'center';
      ctx.fillText(result, cardX + 497 + index * 22, y + 25);
      ctx.textAlign = 'left';
    }

    ctx.fillStyle = '#475569';
    ctx.font = '500 14px DejaVuSansMono';
    ctx.textAlign = 'right';
    ctx.fillText(String(team.p), colX.p, y + 26);
    ctx.fillText(String(team.w), colX.w, y + 26);
    ctx.fillText(String(team.d), colX.d, y + 26);
    ctx.fillText(String(team.l), colX.l, y + 26);
    ctx.fillText(String(team.gf), colX.gf, y + 26);
    ctx.fillText(String(team.ga), colX.ga, y + 26);
    ctx.fillText(signed(team.gd), colX.gd, y + 26);

    ctx.fillStyle = isTop
      ? 'rgba(16, 185, 129, 0.12)'
      : isBottom
        ? 'rgba(239, 68, 68, 0.12)'
        : 'rgba(15, 23, 42, 0.05)';
    ctx.beginPath();
    ctx.roundRect(colX.pts - 48, y + 10, 48, 24, 6);
    ctx.fill();

    ctx.fillStyle = isTop ? '#059669' : isBottom ? '#ef4444' : '#0f172a';
    ctx.font = 'bold 15px DejaVuSansMono';
    ctx.fillText(String(team.pts), colX.pts - 12, y + 27);
    ctx.textAlign = 'left';
  }

  ctx.fillStyle = '#64748b';
  ctx.font = 'bold 12px DejaVuSansMono';
  ctx.textAlign = 'right';
  const playedCount = data.fixtures.filter(fixture => fixture.played).length;
  ctx.fillText(
    `Teams: ${rows.length} • Fixtures: ${data.fixtures.length} • Played: ${playedCount}`,
    cardX + cardWidth - 35,
    cardY + cardHeight - 28
  );

  return canvas.toBuffer('image/png');
}

module.exports = {
  buildHFStandingsImage,
  buildStandingsRows
};
