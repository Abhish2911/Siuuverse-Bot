const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { cachedGetData } = require('../utils/helpers');
const path = require('path');
const antonFontPath = path.join(__dirname, '../assets/fonts/Anton-Regular.ttf');
GlobalFonts.registerFromPath(antonFontPath, 'Anton');
const dejavuFontPath = path.join(__dirname, '../assets/fonts/DejaVuSansMono.ttf');
GlobalFonts.registerFromPath(dejavuFontPath, 'DejaVuSansMono');

function clean(value) {
  return String(value || '').trim();
}

function sortTeams(a, b) {
  const ptsA = Number(a[10] || 0);
  const ptsB = Number(b[10] || 0);
  if (ptsB !== ptsA) return ptsB - ptsA;

  const gdA = Number(a[9] || 0);
  const gdB = Number(b[9] || 0);
  if (gdB !== gdA) return gdB - gdA;

  const gfA = Number(a[7] || 0);
  const gfB = Number(b[7] || 0);
  return gfB - gfA;
}

async function buildLiveStandings2Image() {

    const rows = await cachedGetData('UCL_Coop_Group_Standings!A:K');
    const teamsSheet = await cachedGetData('Teams!A:Z');

    const teamNameMap = new Map();
    for (let i = 1; i < (teamsSheet?.length || 0); i++) {
      const r = teamsSheet[i];

      // Teams sheet:
      // A = Team Name
      // C = Short Name
      const fullName = clean(r[0]);
      const shortName = clean(r[2]).toUpperCase();

      if (shortName && fullName) {
        teamNameMap.set(shortName, fullName);
      }
    }

    if (!rows || rows.length <= 1) {
      return interaction.editReply({ content: '❌ No standings data found.' });
    }

    // 1. Process Master Data Tier Logic
    const groups = {};
    
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      let groupName = clean(row[0]).toUpperCase();
      if (!groupName) continue;
      
      if (!groupName.startsWith('GROUP')) {
        groupName = `GROUP ${groupName}`;
      }
      
      if (!groups[groupName]) groups[groupName] = [];
      groups[groupName].push(row);
    }

    // Sort teams within each group
    for (const g in groups) {
      groups[g].sort(sortTeams);
    }

    // Identify the best two 3rd-placed teams across all groups
    const thirdPlaceTeams = [];
    for (const g in groups) {
      if (groups[g].length >= 3) {
        thirdPlaceTeams.push(groups[g][2]); // Index 2 is the 3rd place team
      }
    }
    thirdPlaceTeams.sort(sortTeams);
    const bestTwoThirdTeams = thirdPlaceTeams.slice(0, 2);

    // 2. Exact Canvas Dimensioning (Grid Layout)
    const groupNames = Object.keys(groups).sort();
    const columns = 2;
    const rowsOfGroups = Math.ceil(groupNames.length / columns);
    
    // Sizing for individual group blocks
    const teamsPerGroup = 6;
    const headerHeight = 35;
    const rowHeight = 32;
    const groupBlockWidth = 460;
    const groupBlockHeight = headerHeight + (teamsPerGroup * rowHeight);
    
    const marginX = 40;
    const marginY = 40;
    const startX = 60;
    const startY = 100;
    
    const canvasWidth = startX * 2 + (groupBlockWidth * columns) + marginX;
    const canvasHeight = startY + (rowsOfGroups * groupBlockHeight) + (rowsOfGroups * marginY) + 60;

    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d');
    const backgroundPath = path.join(__dirname, '../assets/uclbg.png');
    console.log('Loading background:', backgroundPath);
    const backgroundImage = await loadImage(backgroundPath);

    // --- UCL BACKGROUND IMAGE ---
    ctx.drawImage(backgroundImage, 0, 0, canvasWidth, canvasHeight);

    // Dark overlay for readability
    ctx.fillStyle = 'rgba(0, 5, 25, 0.55)';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // UCL style diagonal/grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = -canvasHeight; i < canvasWidth; i += 60) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + canvasHeight, canvasHeight);
      ctx.stroke();
    }

    for (let y = 0; y < canvasHeight; y += 50) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvasWidth, y);
      ctx.stroke();
    }

    // Top Title
    ctx.fillStyle = '#ffffff';
    ctx.font = '64px "Anton"';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 12;
    ctx.fillText('GROUP STANDINGS', canvasWidth / 2, 70);
    ctx.shadowBlur = 0;

    // --- 4. RENDER GRID BLOCKS ---
    groupNames.forEach((gName, index) => {
      const col = index % columns;
      const rowIdx = Math.floor(index / columns);
      
      const x = startX + col * (groupBlockWidth + marginX);
      const y = startY + rowIdx * (groupBlockHeight + marginY);

      // Group Header Background
      const headerGradient = ctx.createLinearGradient(x, y, x + groupBlockWidth, y);
      headerGradient.addColorStop(0, '#102ea8');
      headerGradient.addColorStop(0.5, '#2147d9');
      headerGradient.addColorStop(1, '#0a1e72');
      ctx.fillStyle = headerGradient;
      ctx.fillRect(x, y, groupBlockWidth, headerHeight);

      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.strokeRect(x, y, groupBlockWidth, headerHeight);
      
      // Group Header Text
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 18px DejaVuSansMono';
      ctx.textAlign = 'left';
      ctx.fillText(gName, x + 20, y + 23);
      
      ctx.font = 'bold 13px DejaVuSansMono';
      ctx.fillStyle = '#8e9cc2';
      ctx.textAlign = 'center';
      ctx.fillText('P', x + 310, y + 23);
      ctx.fillText('GD', x + 360, y + 23);
      ctx.fillText('PTS', x + 420, y + 23);

      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.moveTo(x + 285, y);
      ctx.lineTo(x + 285, y + groupBlockHeight);
      ctx.stroke();

      const teams = groups[gName];

      // Render up to 6 teams per block
      for (let tIndex = 0; tIndex < teamsPerGroup; tIndex++) {
        const teamRow = teams[tIndex];
        const rowY = y + headerHeight + (tIndex * rowHeight);
        
        // Alternating row colors matching image
        const rowGradient = ctx.createLinearGradient(x, rowY, x + groupBlockWidth, rowY);
        rowGradient.addColorStop(0, tIndex % 2 === 0 ? '#1438c7' : '#0a238a');
        rowGradient.addColorStop(1, tIndex % 2 === 0 ? '#071c74' : '#05124a');
        ctx.fillStyle = rowGradient;
        ctx.fillRect(x, rowY, groupBlockWidth, rowHeight);

        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.strokeRect(x, rowY, groupBlockWidth, rowHeight);

        ctx.beginPath();
        ctx.moveTo(x, rowY + rowHeight - 1);
        ctx.lineTo(x + groupBlockWidth, rowY + rowHeight - 1);
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.stroke();

        if (!teamRow) continue; // Skip if group has fewer than 6 teams

        const isTop2 = tIndex < 2;
        const isBestThird = tIndex === 2 && bestTwoThirdTeams.includes(teamRow);
        const isQualified = isTop2 || isBestThird;

        // Typography weights based on qualification
        ctx.fillStyle = isQualified ? '#ffffff' : '#6f83b5';
        ctx.font = 'bold 14px DejaVuSansMono';
        
        // Team Rank & Name
        ctx.textAlign = 'left';
        const shortName = (clean(teamRow[1]) || clean(teamRow[2]) || 'UNKNOWN').toUpperCase();
        let teamName = teamNameMap.get(shortName) || shortName;
        teamName = teamName.toUpperCase();
        if (isQualified) teamName += ' (Q)'; // Add marker
        
        ctx.fillText(`${tIndex + 1}`, x + 20, rowY + 21);
        
        // Qualification color tint for team name
        if (isTop2) ctx.fillStyle = '#ffffff';
        else if (isBestThird) ctx.fillStyle = '#a3b8ff'; // Slightly different tint for 3rd place Q
        
        let displayName = teamName;
        if (displayName.length > 26) displayName = `${displayName.slice(0, 26)}...`;
        ctx.fillText(displayName, x + 42, rowY + 21);

        // Stats (P, GD, PTS)
        const p = clean(teamRow[3]) || '0';
        const gd = Number(teamRow[9] || 0);
        const pts = clean(teamRow[10]) || '0';

        ctx.textAlign = 'center';
        ctx.fillStyle = isQualified ? '#ffffff' : '#6f83b5';
        
        ctx.fillText(p, x + 310, rowY + 21);
        ctx.fillText(gd > 0 ? `+${gd}` : `${gd}`, x + 360, rowY + 21);
        
        // Highlight Points
        ctx.fillStyle = isQualified ? '#22d3ee' : '#6f83b5'; 
        ctx.fillText(pts, x + 420, rowY + 21);
      }
    });

    return canvas.toBuffer('image/png');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('uclstandings2')
    .setDescription('Generates a TV-broadcast style Grid layout for group standings'),

  async execute(interaction) {
    const attachment = new AttachmentBuilder(
      await buildLiveStandings2Image(),
      { name: 'ucl-group-grid.png' }
    );

    return interaction.editReply({ files: [attachment] });
  }

,

  buildLiveStandings2Image,

  async generateImage() {
    return await buildLiveStandings2Image();
  }
};
