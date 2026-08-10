const {
  canUseHFCaptainCommands,
  findPlayerByUserId,
  isBotOwner,
  loadHandFootballData,
  upsertHFTeamMeta
} = require('../utils/handfootball');
const E = require('../utils/emojis');

function parseTarget(args, captainPlayer, owner) {
  const body = args.join(' ').trim();
  const separatorIndex = body.indexOf('|');

  if (owner && separatorIndex !== -1) {
    return {
      team: body.slice(0, separatorIndex).trim(),
      color: body.slice(separatorIndex + 1).trim()
    };
  }

  return {
    team: captainPlayer?.team || '',
    color: body
  };
}

function normalizeColor(value) {
  const color = String(value || '').trim();
  const withHash = color.startsWith('#') ? color : `#${color}`;

  return /^#[0-9a-f]{6}$/i.test(withHash)
    ? withHash.toUpperCase()
    : '';
}

module.exports = {
  name: 'color',
  aliases: ['hfcolor'],

  async execute(message, args) {
    if (!canUseHFCaptainCommands(message)) {
      return message.reply(`${E.wrong} Only HandFootball captains can update team colors.`);
    }

    const owner = isBotOwner(message);
    const data = await loadHandFootballData();
    const captainPlayer = findPlayerByUserId(data.players, message.author.id);

    if (!owner && !captainPlayer?.isCaptain) {
      return message.reply(`${E.wrong} Only registered HandFootball team captains can update their color.`);
    }

    const { team, color } = parseTarget(args, captainPlayer, owner);
    const normalizedColor = normalizeColor(color);

    if (!team || !normalizedColor) {
      return message.reply(`${E.blueIcon} Usage: \`.color #5865F2\` or owner: \`.color Team Name | #5865F2\``);
    }

    await upsertHFTeamMeta(team, { color: normalizedColor });
    return message.reply(`${E.correct} Updated color for **${team}** to \`${normalizedColor}\`.`);
  }
};
