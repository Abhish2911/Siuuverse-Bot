const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas } = require('@napi-rs/canvas');
const { cachedGetData } = require('../utils/helpers');

const TEAMS_SHEET_RANGE = 'Teams!A:Q';

async function buildLiveStandings2Image() {

    const canvas = createCanvas(1200, 1000); // Increased height slightly for breathing room
    const ctx = canvas.getContext('2d');

    // --- 1. PREMIUM BACKGROUND DESIGN ---
    // Deep cyber-sports gradient
    const bg = ctx.createLinearGradient(0, 0, 1200, 1000);
    bg.addColorStop(0, '#060814');
    bg.addColorStop(0.5, '#0b112c');
    bg.addColorStop(1, '#050716');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Outer glowing frame
    ctx.strokeStyle = 'rgba(6,182,212,0.25)';
    ctx.lineWidth = 3;
    ctx.strokeRect(15, 15, canvas.width - 30, canvas.height - 30);

    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.strokeRect(22, 22, canvas.width - 44, canvas.height - 44);

    // Subtle background grid lines for tech vibe
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.03)';
    ctx.lineWidth = 1;
    for (let i = 0; i < canvas.width; i += 40) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, canvas.height);
      ctx.stroke();
    }

    // High-tech accent ambient glows
    const createGlow = (x, y, radius, color) => {
      const glow = ctx.createRadialGradient(x, y, 10, x, y, radius);
      glow.addColorStop(0, color);
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    };
    
    ctx.globalAlpha = 0.4;
    createGlow(1100, 150, 350, 'rgba(6, 182, 212, 0.15)'); // Cyan top-right
    createGlow(100, 850, 400, 'rgba(99, 102, 241, 0.15)'); // Indigo bottom-left
    ctx.globalAlpha = 1.0;

    // Trophy silhouette watermark
    ctx.save();
    ctx.globalAlpha = 0.04;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(920, 260);
    ctx.lineTo(980, 260);
    ctx.lineTo(1010, 420);
    ctx.lineTo(890, 420);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(930, 420, 40, 80);
    ctx.fillRect(900, 500, 100, 20);
    ctx.restore();

    // Lion watermark
    ctx.save();
    ctx.globalAlpha = 0.03;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(220, 260, 90, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Decorative geometric vector lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 150); ctx.lineTo(300, 150); ctx.lineTo(350, 200); ctx.lineTo(1200, 200);
    ctx.stroke();

    // --- 2. HEADER PANEL (Glassmorphism) ---
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(40, 30, 1120, 80, 16);
    ctx.fill();
    ctx.stroke();

    // Cyan accent tag on the left of header
    ctx.fillStyle = '#06b6d4';
    ctx.beginPath();
    ctx.roundRect(40, 30, 8, 80, [16, 0, 0, 16]);
    ctx.fill();

    // Header Typography
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 38px Arial';
    ctx.fillText('SIUUVERSE ePREMIER LEAGUE', 75, 83);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 18px Arial';
    ctx.textAlign = 'right';
    ctx.fillText('SEASON 2 STANDINGS', 1130, 77);
    ctx.textAlign = 'left'; // Reset alignment

    // --- 3. TABLE HEADER ---
    ctx.fillStyle = 'rgba(15, 23, 42, 0.6)';
    ctx.beginPath();
    ctx.roundRect(40, 135, 1120, 45, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(6,182,212,0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 14px Arial';
    ctx.fillText('POS', 65, 162);
    ctx.fillText('TEAM', 155, 162);
    ctx.fillText('FORM', 600, 162);
    ctx.fillText('P', 720, 162);
    ctx.fillText('W', 770, 162);
    ctx.fillText('D', 820, 162);
    ctx.fillText('L', 870, 162);
    ctx.fillText('GF', 930, 162);
    ctx.fillText('GA', 990, 162);
    ctx.fillText('GD', 1050, 162);

    ctx.textAlign = 'right';
    ctx.fillText('PTS', 1125, 162);
    ctx.textAlign = 'left';

    // --- 4. DATA PROCESSING ---
    const [standings, teamRows, fixtures] = await Promise.all([
      cachedGetData('Standings!A:J'),
      cachedGetData('Teams!A:H'),
      cachedGetData('Fixtures!A:J')
    ]);

    const normalize = str => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    const teamMap = {};
    teamRows.slice(1).forEach(row => {
      teamMap[normalize(row[0])] = row;
      if (row[2]) {
        teamMap[normalize(row[2])] = row;
      }
    });

    const formMap = {};

    const completedMatches = fixtures
      .slice(1)
      .filter(row => row[2] && row[3] && row[4] !== '' && row[5] !== '')
      .sort((a, b) => Number(a[0] || 0) - Number(b[0] || 0));

    for (const match of completedMatches) {
      const home = normalize(match[2]);
      const away = normalize(match[3]);

      const hg = Number(match[4]) || 0;
      const ag = Number(match[5]) || 0;

      if (!formMap[home]) formMap[home] = [];
      if (!formMap[away]) formMap[away] = [];

      if (hg > ag) {
        formMap[home].push('W');
        formMap[away].push('L');
      } else if (hg < ag) {
        formMap[home].push('L');
        formMap[away].push('W');
      } else {
        formMap[home].push('D');
        formMap[away].push('D');
      }
    }

    const dummyData = standings
      .slice(1)
      .map((row, index) => ({
        rank: Number(row[0]) || index + 1,
        name: row[1] || `Team ${index + 1}`,
        short: (teamMap[normalize(row[1])] && teamMap[normalize(row[1])][2]) || '',
        logo: null,
        color: (teamMap[normalize(row[1])] && teamMap[normalize(row[1])][7]) || '#475569',
        p: Number(row[2]) || 0,
        w: Number(row[3]) || 0,
        d: Number(row[4]) || 0,
        l: Number(row[5]) || 0,
        gf: Number(row[6]) || 0,
        ga: Number(row[7]) || 0,
        gd: Number(row[8]) || 0,
        pts: Number(row[9]) || 0,
        form: (formMap[normalize(row[1])] || []).slice(-5)
      }))
      .slice(0, 18);

    const rankColors = ['#fbbf24', '#d1d5db', '#cd7c2f'];

    // --- 5. ROW GENERATION LOOP ---
    const rowHeight = 42;
    const startY = 200;

    for (let index = 0; index < dummyData.length; index++) {
      const team = dummyData[index];
      const y = startY + index * rowHeight;

      const clubColor = team.color || '#475569';

      // Zebra striping with premium dark tones
      ctx.fillStyle = index % 2 === 0
        ? 'rgba(255, 255, 255, 0.02)'
        : 'rgba(255, 255, 255, 0.005)';
      
      ctx.beginPath();
      ctx.roundRect(40, y, 1120, 34, 6);
      ctx.fill();
      ctx.strokeStyle = 'rgba(6,182,212,0.08)';
      ctx.stroke();

      ctx.fillStyle = clubColor;
      ctx.fillRect(40, y, 4, 34);

      // Zone Indicators (Top 3 Champions League / Bottom 3 Relegation)
      ctx.fillStyle = '#cbd5e1';
      ctx.font = 'bold 15px Arial';
      ctx.fillText(String(team.rank), 68, y + 22);

      // Row Text Elements
      ctx.fillStyle = '#ffffff';
      ctx.font = index < 3 ? 'bold 16px Arial' : '500 16px Arial';
      ctx.fillText(team.name, 110, y + 22);

      ctx.fillStyle = clubColor;
      ctx.font = 'bold 12px Arial';
      ctx.fillText(team.short || '', 495, y + 22);

      const form = team.form && team.form.length
        ? team.form
        : ['-', '-', '-', '-', '-'];

      const formStartX = 600;

      for (let i = 0; i < form.length; i++) {
        const result = form[i];

        ctx.fillStyle = result === 'W'
          ? '#22c55e'
          : result === 'D'
            ? '#f59e0b'
            : result === 'L'
              ? '#ef4444'
              : 'rgba(255, 255, 255, 0.15)';

        ctx.beginPath();
        ctx.roundRect(formStartX + (i * 22), y + 7, 18, 18, 4);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px Arial';
        ctx.fillText(result, formStartX + 5 + (i * 22), y + 20);
      }

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '14px Arial';
      ctx.fillText(String(team.p), 720, y + 22);
      ctx.fillText(String(team.w), 770, y + 22);
      ctx.fillText(String(team.d), 820, y + 22);
      ctx.fillText(String(team.l), 870, y + 22);
      ctx.fillText(String(team.gf), 930, y + 22);
      ctx.fillText(String(team.ga), 990, y + 22);
      ctx.fillText(String(team.gd), 1050, y + 22);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 16px Arial';
      ctx.fillText(String(team.pts), 1125, y + 22);
      ctx.textAlign = 'left'; // Reset

      if (team.rank <= 4) {
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(1150, y + 4);
        ctx.lineTo(1150, y + 30);
        ctx.stroke();
      }

      if (team.rank >= 16) {
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(1150, y + 4);
        ctx.lineTo(1150, y + 30);
        ctx.stroke();
      }
    }

    // --- 6. DISCORD ATTACHMENT SEND ---
    return canvas.toBuffer('image/png');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('standings2')
    .setDescription('Generates a premium, ePremier-style standings image'),

  async execute() {
    const attachment = new AttachmentBuilder(
      await buildLiveStandings2Image(),
      { name: 'standings-s2.png' }
    );

    return {
      files: [attachment]
    };
  },

  buildLiveStandings2Image,

  async generateImage() {
    return await buildLiveStandings2Image();
  }
};
