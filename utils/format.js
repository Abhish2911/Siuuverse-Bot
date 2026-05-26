// utils/format.js

// 🔤 normalize names
function normalize(value) {
  return String(value || '').toLowerCase().trim();
}

// ✂️ remove TEAM-player prefix
function stripTeamPrefix(value) {
  const text = String(value || '').trim();
  return text.includes('-') ? text.split('-').slice(1).join('-').trim() : text;
}

// 👥 split merged players
function splitPlayers(value) {
  return String(value || '')
    .split(',')
    .map(player => stripTeamPrefix(player).trim())
    .filter(Boolean);
}

// ✂️ shorten names for mobile UI
function shorten(value, len = 10) {
  const str = String(value || '');
  return str.length > len ? `${str.slice(0, len - 1)}…` : str;
}

// 📱 shorten merged player list
function shortenPlayers(value, len = 10) {
  return splitPlayers(value)
    .map(player => shorten(player, len))
    .join(', ');
}

// 📏 padding
function padEnd(value, len) {
  return String(value ?? '').padEnd(len, ' ');
}

function padStart(value, len) {
  return String(value ?? '').padStart(len, ' ');
}

// 📋 center text for tables
function padCenter(value, len) {
  const str = String(value ?? '');

  if (str.length >= len) {
    return str;
  }

  const left = Math.floor((len - str.length) / 2);
  const right = len - str.length - left;

  return ' '.repeat(left) + str + ' '.repeat(right);
}

// 🎨 ANSI colors
const colors = {
  cyan: (text) => `\u001b[36m${text}\u001b[0m`,
  green: (text) => `\u001b[32m${text}\u001b[0m`,
  red: (text) => `\u001b[31m${text}\u001b[0m`,
  yellow: (text) => `\u001b[33m${text}\u001b[0m`
};

// ✨ theme helpers
const theme = {
  success: '🟢',
  danger: '🔴',
  warning: '🟡',
  info: '🔵',
  trophy: '🏆',
  league: '⚽'
};

// 🏆 result color logic
function resultColor(hg, ag, text) {
  if (hg > ag) return colors.green(text);
  if (hg < ag) return colors.red(text);
  return colors.yellow(text);
}

module.exports = {
  normalize,
  stripTeamPrefix,
  splitPlayers,
  shorten,
  shortenPlayers,
  padEnd,
  padStart,
  padCenter,
  colors,
  theme,
  resultColor
};