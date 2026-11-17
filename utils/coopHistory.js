const CoopSeason = require('../models/coop/CoopSeason');
const CoopCompetition = require('../models/coop/CoopCompetition');
const CoopTeamSeason = require('../models/coop/CoopTeamSeason');
const CoopPlayerSeason = require('../models/coop/CoopPlayerSeason');
const CoopAward = require('../models/coop/CoopAward');
const { isCoopMongoActivated } = require('./coopMongo');

const COMPETITION_LABELS = {
  league: 'Coop / League',
  fa_cup: 'FA Cup',
  carabao_cup: 'Carabao Cup',
  ucl: 'UCL'
};

const PLAYER_TROPHIES = [
  ['league', 'League Title', 'winner', 18],
  ['league', 'League Runner-Up', 'runner_up', 19],
  ['fa_cup', 'FA Cup', 'winner', 20],
  ['fa_cup', 'FA Cup Runner-Up', 'runner_up', 21],
  ['carabao_cup', 'Carabao Cup', 'winner', 22],
  ['carabao_cup', 'Carabao Cup Runner-Up', 'runner_up', 23],
  ['ucl', 'UCL', 'winner', 24],
  ['ucl', 'UCL Runner-Up', 'runner_up', 25]
];

const TEAM_TROPHIES = [
  ['league', 'League Title', 'winner', 10],
  ['league', 'League Runner-Up', 'runner_up', 11],
  ['fa_cup', 'FA Cup', 'winner', 12],
  ['fa_cup', 'FA Cup Runner-Up', 'runner_up', 13],
  ['carabao_cup', 'Carabao Cup', 'winner', 14],
  ['carabao_cup', 'Carabao Cup Runner-Up', 'runner_up', 15],
  ['ucl', 'UCL', 'winner', 16]
];

function trophyCount(honours = []) {
  return honours.filter(honour => honour.placement === 'winner').length;
}

function seasonLabel(season, seasonKey) {
  return season?.label || seasonKey;
}

function compareSeasonKeys(left, right) {
  const leftNumber = Number(String(left || '').match(/\d+/)?.[0] || 0);
  const rightNumber = Number(String(right || '').match(/\d+/)?.[0] || 0);
  return leftNumber - rightNumber || String(left).localeCompare(String(right));
}

async function getMongoAwardRows() {
  if (!await isCoopMongoActivated()) return null;
  const [awards, seasons] = await Promise.all([
    CoopAward.find({}).lean(),
    CoopSeason.find({}).lean()
  ]);
  const seasonLabels = new Map(seasons.map(season => [season.seasonKey, season.label]));
  awards.sort((left, right) =>
    compareSeasonKeys(right.seasonKey, left.seasonKey) ||
    left.competitionKey.localeCompare(right.competitionKey) ||
    left.awardName.localeCompare(right.awardName)
  );
  return [
    ['Season', 'Recipient', 'Award', 'Value', 'Competition', 'Awarded At'],
    ...awards.map(award => [
      seasonLabels.get(award.seasonKey) || award.seasonKey,
      award.recipientName,
      award.awardName,
      award.value ?? '',
      COMPETITION_LABELS[award.competitionKey] || award.competitionKey,
      award.awardedAt?.toISOString?.() || ''
    ])
  ];
}

async function getMongoSeasonArchiveRows() {
  if (!await isCoopMongoActivated()) return null;
  const [competitions, seasons, awards] = await Promise.all([
    CoopCompetition.find({}).lean(),
    CoopSeason.find({}).lean(),
    CoopAward.find({}).lean()
  ]);
  const seasonLabels = new Map(seasons.map(season => [season.seasonKey, season.label]));
  competitions.sort((left, right) =>
    compareSeasonKeys(left.seasonKey, right.seasonKey) ||
    left.competitionKey.localeCompare(right.competitionKey)
  );
  const awardsByCompetition = new Map();
  for (const award of awards) {
    const key = `${award.seasonKey}|${award.competitionKey}`;
    if (!awardsByCompetition.has(key)) awardsByCompetition.set(key, []);
    awardsByCompetition.get(key).push(award);
  }

  return [
    ['Season', 'Champion', 'Runner Up', 'Golden Boot', 'Playmaker', 'MVP', 'Best Defender', 'Best GK', 'Fair Play', 'Relegated Teams', 'Type', 'Archived At'],
    ...competitions.map(competition => {
      const key = `${competition.seasonKey}|${competition.competitionKey}`;
      const seasonAwards = awardsByCompetition.get(key) || [];
      const recipients = awardName => [...new Set(seasonAwards
        .filter(award => award.awardName.toLowerCase().includes(awardName))
        .map(award => award.recipientName))].join(' / ');
      return [
        seasonLabels.get(competition.seasonKey) || competition.seasonKey,
        competition.champion?.name || 'N/A',
        competition.runnerUp?.name || 'N/A',
        recipients('golden boot') || recipients('top scorer') || 'N/A',
        recipients('playmaker') || 'N/A',
        recipients('mvp') || recipients('best player') || 'N/A',
        recipients('defender') || 'N/A',
        recipients('best gk') || recipients('goalkeeper') || 'N/A',
        recipients('fair play') || 'N/A',
        recipients('relegated') || 'N/A',
        COMPETITION_LABELS[competition.competitionKey] || competition.name,
        competition.archivedAt?.toISOString?.() || ''
      ];
    })
  ];
}

async function getMongoPlayerArchiveRows() {
  if (!await isCoopMongoActivated()) return null;
  const [records, seasons] = await Promise.all([
    CoopPlayerSeason.find({}).lean(),
    CoopSeason.find({}).lean()
  ]);
  const seasonLabels = new Map(seasons.map(season => [season.seasonKey, season.label]));
  records.sort((left, right) =>
    compareSeasonKeys(left.seasonKey, right.seasonKey) ||
    left.legacyName.localeCompare(right.legacyName)
  );

  return [
    ['Player', 'Discord ID', 'Team', 'Season', 'Matches'],
    ...records.map(record => {
      const row = Array(32).fill('');
      const stats = record.stats || {};
      row[0] = record.legacyName;
      row[1] = record.discordId || '';
      row[2] = record.legacyTeamName || '';
      row[3] = seasonLabels.get(record.seasonKey) || record.seasonKey;
      row[4] = stats.matches || 0;
      row[5] = stats.wins || 0;
      row[6] = stats.draws || 0;
      row[7] = stats.losses || 0;
      row[8] = stats.goals || 0;
      row[9] = stats.assists || 0;
      row[10] = stats.goalContributions || 0;
      row[11] = stats.mvps || 0;
      row[12] = stats.tackles || 0;
      row[13] = stats.interceptions || 0;
      row[14] = stats.saves || 0;
      row[15] = stats.yellowCards || 0;
      row[16] = stats.redCards || 0;
      row[17] = Math.max(trophyCount(record.honours), stats.legacyTrophyCount || 0);
      for (const [competitionKey, , placement, index] of PLAYER_TROPHIES) {
        row[index] = record.honours.some(honour =>
          honour.competitionKey === competitionKey && honour.placement === placement
        ) ? 1 : 0;
      }
      row[26] = stats.awards || 0;
      row[27] = stats.mvps || 0;
      row[28] = stats.cleanSheets || 0;
      row[29] = COMPETITION_LABELS[record.competitionKey] || record.competitionKey;
      row[30] = '';
      row[31] = record.teamKey || '';
      return row;
    })
  ];
}

async function getMongoTeamArchiveRows() {
  if (!await isCoopMongoActivated()) return null;
  const [records, seasons] = await Promise.all([
    CoopTeamSeason.find({}).lean(),
    CoopSeason.find({}).lean()
  ]);
  const seasonLabels = new Map(seasons.map(season => [season.seasonKey, season.label]));
  records.sort((left, right) =>
    compareSeasonKeys(left.seasonKey, right.seasonKey) ||
    left.legacyName.localeCompare(right.legacyName)
  );

  return [
    ['Team', 'Season', 'Matches', 'Wins', 'Draws', 'Losses', 'Goals For', 'Goals Against', 'Goal Difference', 'Points'],
    ...records.map(record => {
      const row = Array(21).fill('');
      const stats = record.stats || {};
      row[0] = record.legacyName;
      row[1] = seasonLabels.get(record.seasonKey) || record.seasonKey;
      row[2] = stats.matches || 0;
      row[3] = stats.wins || 0;
      row[4] = stats.draws || 0;
      row[5] = stats.losses || 0;
      row[6] = stats.goalsFor || 0;
      row[7] = stats.goalsAgainst || 0;
      row[8] = stats.goalDifference || 0;
      row[9] = stats.points || 0;
      for (const [competitionKey, , placement, index] of TEAM_TROPHIES) {
        row[index] = record.honours.some(honour =>
          honour.competitionKey === competitionKey && honour.placement === placement
        ) ? 1 : 0;
      }
      row[17] = 'N/A';
      row[18] = COMPETITION_LABELS[record.competitionKey] || record.competitionKey;
      row[19] = '';
      row[20] = record.teamKey || '';
      return row;
    })
  ];
}

module.exports = {
  getMongoAwardRows,
  getMongoPlayerArchiveRows,
  getMongoSeasonArchiveRows,
  getMongoTeamArchiveRows
};
