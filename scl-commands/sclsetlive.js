const { createSclPrefixCommand } = require('../utils/sclPrefixCommand');
const command = createSclPrefixCommand('sclsetlive');

command.restore = client => require('../utils/sclLiveStandings').startSclLiveUpdater(client);

module.exports = command;
