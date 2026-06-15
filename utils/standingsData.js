

const { cachedGetData } = require('./helpers');

function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

async function getLeagueStandingsData() {
  const [standings, teams, fixtures] = await Promise.all([
    cachedGetData('Standings!A:J'),
    cachedGetData('Teams!A:H'),
    cachedGetData('Fixtures!A:J')
  ]);

  const teamMap = {};

  teams.slice(1).forEach(row => {
    teamMap[normalize(row[0])] = row;

    if (row[2]) {
      teamMap[normalize(row[2])] = row;
    }
  });

  const formMap = {};

  fixtures
    .slice(1)
    .filter(row => row[2] && row[3] && row[4] !== '' && row[5] !== '')
    .forEach(match => {
      const home = normalize(match[2]);
      const away = normalize(match[3]);

      const hg = Number(match[4]) || 0;
      const ag = Number(match[5]) || 0;

      if (!formMap[home]) formMap[home] = [];
      if (!formMap[away]) formMap[away] = [];

      if (hg > ag) {
        formMap[home].push('W');
        formMap[away].push('L');
      } else if (ag > hg) {
        formMap[home].push('L');
        formMap[away].push('W');
      } else {
        formMap[home].push('D');
        formMap[away].push('D');
      }
    });

  return standings
    .slice(1)
    .map((row, index) => {
      const teamRow = teamMap[normalize(row[1])] || [];

      return {
        rank: Number(row[0]) || index + 1,
        name: row[1] || '',
        short: teamRow[2] || '',
        color: teamRow[7] || '#475569',
        logo: `${String(row[1] || '')
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')}.png`,
        p: Number(row[2]) || 0,
        w: Number(row[3]) || 0,
        d: Number(row[4]) || 0,
        l: Number(row[5]) || 0,
        gf: Number(row[6]) || 0,
        ga: Number(row[7]) || 0,
        gd: Number(row[8]) || 0,
        pts: Number(row[9]) || 0,
        form: (formMap[normalize(row[1])] || []).slice(-5)
      };
    })
    .sort((a, b) =>
      b.pts - a.pts ||
      b.gd - a.gd ||
      b.gf - a.gf
    );
}

module.exports = {
  getLeagueStandingsData
};