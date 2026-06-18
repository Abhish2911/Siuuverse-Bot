const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const { cachedGetData } = require('../utils/helpers');

const dejavuFontPath = path.join(__dirname, '../assets/fonts/DejaVuSansMono.ttf');
GlobalFonts.registerFromPath(dejavuFontPath, 'DejaVuSansMono');

const TEAMS_SHEET_RANGE = 'Teams!A:Q';

async function buildLiveStandings2Image() {
    // Height extended slightly to perfectly fit floating cards + extra row padding gaps
    const canvas = createCanvas(1200, 1120);
    const ctx = canvas.getContext('2d');

    // --- 1. CYAN MATRIX CYBER BACKGROUND ---
    const bg = ctx.createLinearGradient(0, 0, 1200, 1120);
    bg.addColorStop(0, '#030712'); // Pitch obsidian black
    bg.addColorStop(0.5, '#0b1536'); // Deep sapphire navy
    bg.addColorStop(1, '#02050c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Modern Tech Vector Grid Accents
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 245, 160, 0.03)';
    ctx.lineWidth = 1;
    for (let i = 0; i < canvas.width; i += 50) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, canvas.height);
        ctx.stroke();
    }
    ctx.restore();

    // Ambient Lighting Glows
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = '#00f5a0';
    ctx.beginPath();
    ctx.arc(1150, 200, 400, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3b82f6';
    ctx.beginPath();
    ctx.arc(50, 950, 450, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;

    const cardX = 60;
    const cardY = 60;
    const cardWidth = 1080;
    const headerHeight = 80;

    // --- 2. BASE INTERACTIVE CANVAS CONTAINER ---
    ctx.fillStyle = '#f1f5f9'; // Clean modern slate-gray background area
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardWidth, 1000, 20);
    ctx.fill();

    // --- 3. PREMIUM MATTE NAVY HEADER BLOCK ---
    ctx.fillStyle = '#090f26'; 
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardWidth, headerHeight, [20, 20, 0, 0]);
    ctx.fill();

    // High-tech electric line dividing main header sections
    ctx.fillStyle = '#00f5a0';
    ctx.fillRect(cardX, cardY + headerHeight - 4, cardWidth, 4);

    // Title Brand Typography
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px DejaVuSansMono';
    ctx.fillText('SIUUVERSE ePREMIER LEAGUE', cardX + 35, cardY + 46);

    ctx.fillStyle = 'rgba(0, 245, 160, 0.9)';
    ctx.font = 'bold 15px DejaVuSansMono';
    ctx.textAlign = 'right';
    ctx.fillText('SEASON 2 OVERVIEW', cardX + cardWidth - 35, cardY + 46);
    ctx.textAlign = 'left';

    // --- 4. THE SUB-HEADER NAV TRACK STRIP ---
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
        p: cardX + 640,
        w: cardX + 700,
        d: cardX + 760,
        l: cardX + 820,
        gf: cardX + 880,
        ga: cardX + 940,
        gd: cardX + 1000,
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

    // --- 5. DATA FETCHING LAYER ---
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
    })).slice(0, 17); // Sliced neatly to guarantee seamless canvas proportion layout constraints

    // --- 6. FLOATING CREATIVE TABLE ROW PRODUCTION ---
    const rowHeight = 44;
    const rowGap = 7; // Breathing gap spacing converting rows into floating card elements
    const startY = subHeaderY + 55;

    for (let i = 0; i < dummyData.length; i++) {
        const team = dummyData[i];
        const y = startY + i * (rowHeight + rowGap);
        const clubColor = team.color || '#cbd5e1';

        // Simulated Drop Shadow beneath each floating card layer
        ctx.fillStyle = 'rgba(15, 23, 42, 0.04)';
        ctx.beginPath();
        ctx.roundRect(cardX + 2, y + 3, cardWidth - 4, rowHeight, 8);
        ctx.fill();

        // Core Solid Row Floating Board Base
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.roundRect(cardX, y, cardWidth, rowHeight, 8);
        ctx.fill();

        // Left Identity Border Marker Strip
        ctx.fillStyle = clubColor;
        ctx.fillRect(cardX, y, 6, rowHeight);

        // --- CREATIVE ELEMENT A: STYLIZED RANKING SHIELDS ---
        ctx.save();
        if (team.rank <= 4) {
            // Dynamic emerald gradient badge for top-tier promotion positions
            const badgeGrad = ctx.createLinearGradient(cardX + 30, y + 10, cardX + 54, y + 34);
            badgeGrad.addColorStop(0, '#00f5a0');
            badgeGrad.addColorStop(1, '#059669');
            ctx.fillStyle = badgeGrad;
        } else if (team.rank >= 15) {
            ctx.fillStyle = '#fee2e2'; // Light soft red badge background for elimination zone
        } else {
            ctx.fillStyle = '#f1f5f9'; // Clean slate fallback badge
        }
        ctx.beginPath();
        ctx.arc(cardX + 44, y + 22, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Rank Digit Print Content
        ctx.fillStyle = team.rank <= 4 ? '#ffffff' : team.rank >= 15 ? '#ef4444' : '#475569';
        ctx.font = 'bold 13px DejaVuSansMono';
        ctx.textAlign = 'center';
        ctx.fillText(String(team.rank), cardX + 44, y + 26);
        ctx.textAlign = 'left'; // Reset

        // Team Logo Graphic Loader Integration Layer
        if (team.logo) {
            try {
                const img = await loadImage(team.logo);
                ctx.drawImage(img, cardX + 78, y + 10, 24, 24);
            } catch {}
        }

        // Main Profile Labels
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 14px DejaVuSansMono';
        ctx.fillText(team.name.toUpperCase(), cardX + 115, y + 27);

        // Clean subtle pill container backplate for the club short code
        ctx.fillStyle = 'rgba(241, 245, 249, 0.8)';
        ctx.beginPath();
        ctx.roundRect(cardX + 404, y + 12, 50, 20, 4);
        ctx.fill();
        
        ctx.fillStyle = '#475569';
        ctx.font = 'bold 12px DejaVuSansMono';
        ctx.fillText(team.short || '---', cardX + 412, y + 26);

        // --- CREATIVE ELEMENT B: UNIFIED FORM CAPSULE TRACK CONTAINER ---
        ctx.fillStyle = '#f1f5f9';
        ctx.beginPath();
        ctx.roundRect(cardX + 484, y + 11, 114, 22, 11);
        ctx.fill();

        const form = team.form.length ? team.form : ['-','-','-','-','-'];
        for (let j = 0; j < form.length; j++) {
            const r = form[j];
            ctx.fillStyle = r === 'W' ? '#10b981' : r === 'D' ? '#f59e0b' : r === 'L' ? '#f43f5e' : '#cbd5e1';

            ctx.beginPath();
            ctx.arc(cardX + 497 + j * 22, y + 22, 8, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#fff';
            ctx.font = 'bold 9px DejaVuSansMono';
            ctx.textAlign = 'center';
            ctx.fillText(r, cardX + 497 + j * 22, y + 25);
            ctx.textAlign = 'left';
        }

        // --- STANDARD MATRIX STATS ROW SETS ---
        ctx.fillStyle = '#475569';
        ctx.font = '500 14px DejaVuSansMono';
        ctx.textAlign = 'right';

        ctx.fillText(String(team.p), colX.p, y + 26);
        ctx.fillText(String(team.w), colX.w, y + 26);
        ctx.fillText(String(team.d), colX.d, y + 26);
        ctx.fillText(String(team.l), colX.l, y + 26);
        ctx.fillText(String(team.gf), colX.gf, y + 26);
        ctx.fillText(String(team.ga), colX.ga, y + 26);
        ctx.fillText(String(team.gd), colX.gd, y + 26);

        // --- CREATIVE ELEMENT C: PREMIUM EMBEDDED HIGH-LIGHT SCORE CARD PILL ---
        ctx.fillStyle = team.rank <= 4 ? 'rgba(16, 185, 129, 0.12)' : 'rgba(15, 23, 42, 0.05)';
        ctx.beginPath();
        ctx.roundRect(colX.pts - 48, y + 10, 48, 24, 6);
        ctx.fill();

        ctx.fillStyle = team.rank <= 4 ? '#059669' : '#0f172a';
        ctx.font = 'bold 15px DejaVuSansMono';
        ctx.fillText(String(team.pts), colX.pts - 12, y + 27);
        ctx.textAlign = 'left'; // Always safely clear configuration state pointers
    }

    return canvas.toBuffer('image/png');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('standings2')
    .setDescription('Generates a premium cyber sapphire standings layout with custom modular row tracks'),

  async execute(interaction) {
    const buffer = await buildLiveStandings2Image();
    const attachment = new AttachmentBuilder(buffer, { name: 'cyber-standings.png' });

    return interaction.editReply({ files: [attachment] });
  },

  buildLiveStandings2Image
};
