const E = require('./emojis');
const mongoose = require('mongoose');
const { refreshAllHFLiveMessages } = require('./handfootballLive');

function parseScore(value) {
  const match = String(value || '').trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!match) return null;

  return {
    homeGoals: Number(match[1]),
    awayGoals: Number(match[2])
  };
}

async function refreshHFStandings(client) {
  if (mongoose.connection.readyState !== 1) {
    return 'MongoDB not connected';
  }

  try {
    const results = await refreshAllHFLiveMessages(client, 'standings');
    return Array.isArray(results) && results.length ? 'Updated' : 'No live standings message configured';
  } catch (error) {
    console.error('❌ HF standings refresh after result failed:', error);
    return 'Refresh failed';
  }
}

function buildResultMessage({ corrected, fixture, homeGoals, awayGoals, oldScore = '' }) {
  const title = corrected ? 'Result corrected' : 'Result submitted';
  return [
    `${corrected ? E.correct : E.correct} **${title}**`,
    `**Match:** #${fixture.matchNo}`,
    `**Fixture:** ${fixture.home} ${E.vs} ${fixture.away}`,
    oldScore ? `**Previous score:** ${oldScore}` : null,
    `**Score:** ${homeGoals}-${awayGoals}`,
    corrected ? 'Reply to this message with `.resultfix H-A` if another correction is needed.' : 'Reply to this message with `.resultfix H-A` to correct this result.'
  ].filter(Boolean).join('\n');
}

module.exports = {
  parseScore,
  refreshHFStandings,
  buildResultMessage
};
