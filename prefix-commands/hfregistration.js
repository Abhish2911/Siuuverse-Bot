const {
  isBotOwner,
  isHFRegistrationOpen,
  setHFRegistrationOpen
} = require('../utils/handfootball');
const E = require('../utils/emojis');

function parseState(input) {
  const state = String(input || '').trim().toLowerCase();

  if (['start', 'on', 'open', 'enable', 'enabled'].includes(state)) {
    return true;
  }

  if (['off', 'stop', 'close', 'closed', 'disable', 'disabled'].includes(state)) {
    return false;
  }

  return null;
}

module.exports = {
  name: 'hfregistration',
  aliases: ['hftournament', 'hfregtoggle'],

  async execute(message, args) {
    if (!isBotOwner(message)) {
      return message.reply(`${E.wrong} Only the bot owner can change HandFootball registration status.`);
    }

    const desiredState = parseState(args[0]);

    if (desiredState === null) {
      const currentState = await isHFRegistrationOpen();
      return message.reply(
        `${E.calendar} HandFootball registration is currently **${currentState ? 'OPEN' : 'CLOSED'}** ${currentState ? E.correct : E.lock}.\n` +
        'Use `.hfregistration start` or `.hfregistration off`.'
      );
    }

    await setHFRegistrationOpen(desiredState);

    return message.reply(
      `${desiredState ? E.correct : E.lock} HandFootball registration is now **${desiredState ? 'OPEN' : 'CLOSED'}**.`
    );
  }
};
