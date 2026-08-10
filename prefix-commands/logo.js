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
      logoUrl: body.slice(separatorIndex + 1).trim()
    };
  }

  return {
    team: captainPlayer?.team || '',
    logoUrl: body
  };
}

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

module.exports = {
  name: 'logo',
  aliases: ['hflogo'],

  async execute(message, args) {
    if (!canUseHFCaptainCommands(message)) {
      return message.reply(`${E.wrong} Only HandFootball captains can update team logos.`);
    }

    const owner = isBotOwner(message);
    const data = await loadHandFootballData();
    const captainPlayer = findPlayerByUserId(data.players, message.author.id);

    if (!owner && !captainPlayer?.isCaptain) {
      return message.reply(`${E.wrong} Only registered HandFootball team captains can update their logo.`);
    }

    const { team, logoUrl } = parseTarget(args, captainPlayer, owner);

    if (!team || !logoUrl) {
      return message.reply(`${E.badge} Usage: \`.logo https://image-url\` or owner: \`.logo Team Name | https://image-url\``);
    }

    if (!isValidUrl(logoUrl)) {
      return message.reply(`${E.warning} Logo must be a valid \`http\` or \`https\` image URL.`);
    }

    await upsertHFTeamMeta(team, { logoUrl });
    return message.reply(`${E.correct} Updated logo for **${team}**.`);
  }
};
