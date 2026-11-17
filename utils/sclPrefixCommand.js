// Each public SCL prefix command has its own file in scl-commands. This small
// adapter keeps their behaviour backed by one shared service, so database,
// referee, and command-toggle rules cannot drift apart between commands.
function createSclPrefixCommand(name, aliases = []) {
  return {
    name,
    aliases,
    usesHFTournamentContext: false,
    execute(message, args, client) {
      return require('../scl-commands/scl').run(message, args, client, name);
    }
  };
}

module.exports = { createSclPrefixCommand };
