const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');

GlobalFonts.registerFromPath(path.join(__dirname, '../assets/fonts/ARIALBD.TTF'), 'SiuuArial');

function ellipsis(ctx, value, width) {
  let text = String(value || '—');
  while (text.length > 1 && ctx.measureText(text).width > width) text = `${text.slice(0, -2)}…`;
  return text;
}

function rounded(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function buildSclTableImage({ title, subtitle, headers, rows, accent = '#00f5a0' }) {
  const width = 1200;
  const rowHeight = 54;
  const height = Math.max(510, 230 + Math.max(rows.length, 1) * rowHeight + 90);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#030712'); bg.addColorStop(0.55, '#0b1536'); bg.addColorStop(1, '#02050c');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = 0.10; ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(1080, 100, 280, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3b82f6'; ctx.beginPath(); ctx.arc(65, height - 40, 240, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(255,255,255,0.96)'; rounded(ctx, 50, 42, 1100, height - 84, 22);
  ctx.fillStyle = '#0f172a'; rounded(ctx, 58, 50, 1084, 108, 16);
  ctx.font = 'bold 34px SiuuArial, Arial'; ctx.fillStyle = '#f8fafc'; ctx.fillText(title, 88, 102);
  ctx.font = '20px SiuuArial, Arial'; ctx.fillStyle = '#94a3b8'; ctx.fillText(subtitle, 88, 133);
  const x = 78; const tableWidth = 1044; const y = 182;
  const columns = headers.map((header, index) => ({ ...header, x: x + headers.slice(0, index).reduce((sum, item) => sum + item.width, 0) }));
  ctx.fillStyle = accent; rounded(ctx, x, y, tableWidth, 38, 8);
  ctx.font = 'bold 16px SiuuArial, Arial'; ctx.fillStyle = '#062b25';
  for (const column of columns) ctx.fillText(column.label, column.x + 13, y + 25);
  ctx.font = '20px SiuuArial, Arial';
  rows.forEach((row, index) => {
    const rowY = y + 45 + index * rowHeight;
    ctx.fillStyle = index % 2 ? '#edf2f7' : '#f8fafc'; rounded(ctx, x, rowY, tableWidth, 46, 8);
    columns.forEach(column => {
      const raw = row[column.key];
      ctx.fillStyle = column.key === 'points' ? '#047857' : '#172033';
      ctx.font = column.key === 'points' ? 'bold 20px SiuuArial, Arial' : '20px SiuuArial, Arial';
      const value = column.key === 'rank' ? `#${raw}` : String(raw ?? '—');
      ctx.fillText(ellipsis(ctx, value, column.width - 20), column.x + 13, rowY + 30);
    });
  });
  ctx.font = '16px SiuuArial, Arial'; ctx.fillStyle = '#64748b';
  ctx.fillText(`Siuuverse Champions League • Updated ${new Date().toLocaleString('en-IN')}`, 78, height - 68);
  return canvas.toBuffer('image/png');
}

module.exports = { buildSclTableImage };
