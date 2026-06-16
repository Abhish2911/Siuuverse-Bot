const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const { cachedGetData } = require('../utils/helpers');

const dejavuFontPath = path.join(__dirname, '../assets/fonts/DejaVuSansMono.ttf');
GlobalFonts.registerFromPath(dejavuFontPath, 'DejaVuSansMono');

const TEAMS_SHEET_RANGE = 'Teams!A:Q';

async function buildLiveStandings2Image() {
    const canvas = createCanvas(1200, 1050);
    const ctx = canvas.getContext('2d');

    const bg = ctx.createLinearGradient(0, 0, 1200, 1050);
    bg.addColorStop(0, '#2b003a');
    bg.addColorStop(0.6, '#38003c');
    bg.addColorStop(1, '#1f0022');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.globalAlpha = 0.15;
    ctx.fillStyle = '#ff007f';
    ctx.beginPath();
    ctx.arc(1200, 200, 400, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#00ffcc';
    ctx.beginPath();
    ctx.arc(0, 900, 350, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;

    const cardX = 60;
    const cardY = 60;
    const cardWidth = 1080;
    const headerHeight = 75;

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardWidth, 930, 24);
    ctx.fill();

    // Header bar (same magenta style as before)
    ctx.fillStyle = '#e90052';
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardWidth, headerHeight, [24, 24, 0, 0]);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px DejaVuSansMono';
    ctx.fillText('SIUUVERSE ePREMIER LEAGUE', cardX + 30, cardY + 46);

    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = 'bold 18px DejaVuSansMono';
    ctx.textAlign = 'right';
    ctx.fillText('Season 2', cardX + cardWidth - 30, cardY + 46);
    ctx.textAlign = 'left';

    const subHeaderY = cardY + headerHeight;
    ctx.fillStyle = '#d00049';
    ctx.fillRect(cardX, subHeaderY, cardWidth, 45);

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px DejaVuSansMono';

    ctx.fillText('RANK', cardX + 30, subHeaderY + 28);
    ctx.fillText('TEAM', cardX + 100, subHeaderY + 28);
    ctx.fillText('SHORT', cardX + 410, subHeaderY + 28);
    ctx.fillText('FORM', cardX + 480, subHeaderY + 28);

    const colX = {
        p: cardX + 630,
        w: cardX + 690,
        d: cardX + 750,
        l: cardX + 810,
        gf: cardX + 870,
        ga: cardX + 930,
        gd: cardX + 990,
        pts: cardX + 1050
    };

    ctx.textAlign = 'right';
    ctx.fillText('P', colX.p, subHeaderY + 28);
    ctx.fillText('W', colX.w, subHeaderY + 28);
    ctx.fillText('D', colX.d, subHeaderY + 28);
    ctx.fillText('L', colX.l, subHeaderY + 28);
    ctx.fillText('GF', colX.gf, subHeaderY + 28);
    ctx.fillText('GA', colX.ga, subHeaderY + 28);
    ctx.fillText('GD', colX.gd, subHeaderY + 28);
    ctx.fillText('PTS', colX.pts, subHeaderY + 28);
    ctx.textAlign = 'left';

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
    const startY = subHeaderY + 45;

    for (let i = 0; i < dummyData.length; i++) {
        const team = dummyData[i];
        const y = startY + i * rowHeight;
        const clubColor = team.color || '#cbd5e1';

        // Clean alternating row background (solid, no bleed)
        ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#f9fafb';
        ctx.fillRect(cardX, y, cardWidth, rowHeight);

        ctx.fillStyle = clubColor;
        ctx.fillRect(cardX, y, 8, rowHeight);

        ctx.fillStyle = '#1e293b';
        ctx.font = 'bold 16px DejaVuSansMono';
        ctx.fillText(String(team.rank), cardX + 40, y + 28);

        if (team.logo) {
            try {
                const img = await loadImage(team.logo);
                ctx.drawImage(img, cardX + 85, y + 10, 24, 24);
            } catch {}
        }

        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 16px DejaVuSansMono';
        ctx.fillText(team.name, cardX + 100, y + 28);

        ctx.fillStyle = clubColor;
        ctx.font = 'bold 12px DejaVuSansMono';
        ctx.fillText(team.short || '', cardX + 410, y + 28);

        const form = team.form.length ? team.form : ['-','-','-','-','-'];

        for (let j = 0; j < form.length; j++) {
            const r = form[j];
            ctx.fillStyle = r === 'W' ? '#22c55e' : r === 'D' ? '#f59e0b' : r === 'L' ? '#ef4444' : '#ddd';

            ctx.beginPath();
            ctx.roundRect(cardX + 460 + j * 22, y + 8, 18, 18, 4);
            ctx.fill();

            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px DejaVuSansMono';
            ctx.fillText(r, cardX + 465 + j * 22, y + 21);
        }

        ctx.fillStyle = '#334155';
        ctx.font = '500 15px DejaVuSansMono';
        ctx.textAlign = 'right';

        ctx.fillText(String(team.p), colX.p, y + 27);
        ctx.fillText(String(team.w), colX.w, y + 27);
        ctx.fillText(String(team.d), colX.d, y + 27);
        ctx.fillText(String(team.l), colX.l, y + 27);
        ctx.fillText(String(team.gf), colX.gf, y + 27);
        ctx.fillText(String(team.ga), colX.ga, y + 27);
        ctx.fillText(String(team.gd), colX.gd, y + 27);

        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 16px DejaVuSansMono';
        ctx.fillText(String(team.pts), colX.pts, y + 28);

        ctx.textAlign = 'left';

        if (team.rank <= 3) {
            ctx.fillStyle = '#06b6d4';
            ctx.fillRect(cardX + cardWidth - 6, y + 2, 4, rowHeight - 4);
        }

        if (team.rank >= 16) {
            ctx.fillStyle = '#ef4444';
            ctx.fillRect(cardX + cardWidth - 6, y + 2, 4, rowHeight - 4);
        }
    }

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
