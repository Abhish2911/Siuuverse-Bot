const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const { cachedGetData } = require('../utils/helpers');

const dejavuFontPath = path.join(__dirname, '../assets/fonts/DejaVuSansMono.ttf');
GlobalFonts.registerFromPath(dejavuFontPath, 'DejaVuSansMono');

const TEAMS_SHEET_RANGE = 'Teams!A:Q';

async function buildLiveStandings2Image() {
    const canvas = createCanvas(1200, 1120);
    const ctx = canvas.getContext('2d');

    // Cyber background
    const bg = ctx.createLinearGradient(0, 0, 1200, 1120);
    bg.addColorStop(0, '#0f172a'); // navy
    bg.addColorStop(0.5, '#064e3b'); // greenish
    bg.addColorStop(1, '#0f172a'); // navy
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Floating card rows background
    const cardX = 60;
    const cardY = 60;
    const cardWidth = 1080;
    const headerHeight = 75;

    // Card background
    ctx.fillStyle = '#1e293b'; // navy-ish card background
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardWidth, 1000, 24);
    ctx.fill();

    // Header bar
    ctx.fillStyle = '#0f766e'; // dark green header
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardWidth, headerHeight, [24, 24, 0, 0]);
    ctx.fill();

    // Header text
    ctx.fillStyle = '#ecfccb'; // light green text
    ctx.font = 'bold 32px DejaVuSansMono';
    ctx.fillText('SIUUVERSE ePREMIER LEAGUE', cardX + 30, cardY + 50);

    ctx.fillStyle = 'rgba(236,252,203,0.8)';
    ctx.font = 'bold 20px DejaVuSansMono';
    ctx.textAlign = 'right';
    ctx.fillText('Season 2', cardX + cardWidth - 30, cardY + 50);
    ctx.textAlign = 'left';

    // Divider below header
    const dividerY = cardY + headerHeight;
    ctx.fillStyle = '#22c55e'; // bright green divider
    ctx.fillRect(cardX, dividerY, cardWidth, 6);

    // Column headers background
    const subHeaderY = dividerY + 6;
    ctx.fillStyle = '#0f172a'; // dark navy for column header background
    ctx.fillRect(cardX, subHeaderY, cardWidth, 50);

    // Column headers text
    ctx.fillStyle = '#a3e635'; // lime green text
    ctx.font = 'bold 16px DejaVuSansMono';
    ctx.fillText('RANK', cardX + 40, subHeaderY + 32);
    ctx.fillText('TEAM', cardX + 110, subHeaderY + 32);
    ctx.fillText('SHORT', cardX + 420, subHeaderY + 32);
    ctx.fillText('FORM', cardX + 480, subHeaderY + 32);

    const colX = {
        p: cardX + 630,
        w: cardX + 690,
        d: cardX + 750,
        l: cardX + 810,
        gf: cardX + 870,
        ga: cardX + 930,
        gd: cardX + 970,
        pts: cardX + 1085
    };

    ctx.textAlign = 'right';
    ctx.fillText('P', colX.p, subHeaderY + 32);
    ctx.fillText('W', colX.w, subHeaderY + 32);
    ctx.fillText('D', colX.d, subHeaderY + 32);
    ctx.fillText('L', colX.l, subHeaderY + 32);
    ctx.fillText('GF', colX.gf, subHeaderY + 32);
    ctx.fillText('GA', colX.ga, subHeaderY + 32);
    ctx.fillText('GD', colX.gd, subHeaderY + 32);
    ctx.fillText('PTS', colX.pts, subHeaderY + 32);
    ctx.textAlign = 'left';

    // Fetch data
    const [standings, teamRows, fixtures] = await Promise.all([
        cachedGetData('Standings!A:J'),
        cachedGetData('Teams!A:H'),
        cachedGetData('Fixtures!A:J')
    ]);

    const normalize = str => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    const teamMap = {};
    teamRows.slice(1).forEach(row => {
        teamMap[normalize(row[0])] = row;
        if (row[2]) teamMap[normalize(row[2])] = row;
    });

    const formMap = {};

    const completedMatches = fixtures
      .slice(1)
      .filter(r => r[2] && r[3] && r[4] !== '' && r[5] !== '');

    for (const m of completedMatches) {
        const home = normalize(m[2]);
        const away = normalize(m[3]);
        const hg = Number(m[4]) || 0;
        const ag = Number(m[5]) || 0;

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

    const dummyData = standings.slice(1).map((row, i) => ({
        rank: Number(row[0]) || i + 1,
        name: row[1] || `Team ${i + 1}`,
        short: (teamMap[normalize(row[1])] && teamMap[normalize(row[1])][2]) || '',
        logo: (teamMap[normalize(row[1])] && teamMap[normalize(row[1])][3]) || null,
        color: (teamMap[normalize(row[1])] && teamMap[normalize(row[1])][7]) || '#cbd5e1',
        p: Number(row[2]) || 0,
        w: Number(row[3]) || 0,
        d: Number(row[4]) || 0,
        l: Number(row[5]) || 0,
        gf: Number(row[6]) || 0,
        ga: Number(row[7]) || 0,
        gd: Number(row[8]) || 0,
        pts: Number(row[9]) || 0,
        form: (formMap[normalize(row[1])] || []).slice(-5)
    }));

    const rowHeight = 44;
    const startY = subHeaderY + 50;

    for (let i = 0; i < dummyData.length; i++) {
        const team = dummyData[i];
        const y = startY + i * rowHeight;
        const clubColor = team.color || '#cbd5e1';

        // Floating card row background with subtle shadow
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 2;
        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.roundRect(cardX, y, cardWidth, rowHeight, 12);
        ctx.fill();
        ctx.shadowColor = 'transparent';

        // Circular rank badge
        ctx.fillStyle = clubColor;
        ctx.beginPath();
        ctx.arc(cardX + 25, y + rowHeight / 2, 18, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 18px DejaVuSansMono';
        ctx.textAlign = 'center';
        ctx.fillText(String(team.rank), cardX + 25, y + rowHeight / 2 + 7);
        ctx.textAlign = 'left';

        // Team logo
        if (team.logo) {
            try {
                const img = await loadImage(team.logo);
                ctx.drawImage(img, cardX + 65, y + 10, 28, 28);
            } catch {}
        }

        // Team name
        ctx.fillStyle = '#ecfccb';
        ctx.font = 'bold 18px DejaVuSansMono';
        ctx.fillText(team.name, cardX + 110, y + 30);

        // Short name
        ctx.fillStyle = clubColor;
        ctx.font = 'bold 14px DejaVuSansMono';
        ctx.fillText(team.short || '', cardX + 420, y + 30);

        // Form capsules
        const form = team.form.length ? team.form : ['-','-','-','-','-'];
        for (let j = 0; j < form.length; j++) {
            const r = form[j];
            ctx.fillStyle = r === 'W' ? '#22c55e' : r === 'D' ? '#f59e0b' : r === 'L' ? '#ef4444' : '#444';

            ctx.beginPath();
            ctx.roundRect(cardX + 480 + j * 26, y + 12, 22, 22, 12);
            ctx.fill();

            ctx.fillStyle = '#0f172a';
            ctx.font = 'bold 14px DejaVuSansMono';
            ctx.textAlign = 'center';
            ctx.fillText(r, cardX + 480 + j * 26 + 11, y + 28);
            ctx.textAlign = 'left';
        }

        // Stats columns
        ctx.fillStyle = '#a3e635';
        ctx.font = 'bold 16px DejaVuSansMono';
        ctx.textAlign = 'right';

        ctx.fillText(String(team.p), colX.p, y + 30);
        ctx.fillText(String(team.w), colX.w, y + 30);
        ctx.fillText(String(team.d), colX.d, y + 30);
        ctx.fillText(String(team.l), colX.l, y + 30);
        ctx.fillText(String(team.gf), colX.gf, y + 30);
        ctx.fillText(String(team.ga), colX.ga, y + 30);
        ctx.fillText(String(team.gd), colX.gd, y + 30);

        // PTS pill styling
        const ptsText = String(team.pts);
        const ptsWidth = ctx.measureText(ptsText).width + 28;
        const ptsX = colX.pts - ptsWidth + 12;
        const ptsY = y + 6;
        ctx.fillStyle = '#22c55e';
        ctx.beginPath();
        ctx.roundRect(ptsX, ptsY, ptsWidth, 32, 16);
        ctx.fill();

        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 18px DejaVuSansMono';
        ctx.fillText(ptsText, colX.pts, y + 30);

        ctx.textAlign = 'left';

        // Highlight top 3 with a cyan left border
        if (team.rank <= 3) {
            ctx.fillStyle = '#06b6d4';
            ctx.fillRect(cardX, y, 6, rowHeight);
        }

        // Highlight bottom 3 with a red left border
        if (team.rank >= dummyData.length - 2) {
            ctx.fillStyle = '#ef4444';
            ctx.fillRect(cardX, y, 6, rowHeight);
        }
    }

    return canvas.toBuffer('image/png');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('standings2')
    .setDescription('Generates ePremier League standings image'),

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
