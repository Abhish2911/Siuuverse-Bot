const { EmbedBuilder } = require('discord.js');
const { translateWithGrok } = require('./grok');
const { authorizeGrokRequest } = require('./grokControls');

function createTranslationEmbeds({ sourceLanguage, targetLanguage, translation }) {
  const chunks = [];
  let remaining = translation;

  while (remaining.length > 3800) {
    let splitAt = remaining.lastIndexOf(' ', 3800);
    if (splitAt < 1) splitAt = 3800;
    const previousCharacter = remaining.charCodeAt(splitAt - 1);
    if (previousCharacter >= 0xD800 && previousCharacter <= 0xDBFF) {
      splitAt -= 1;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) chunks.push(remaining);

  return chunks.map(chunk => new EmbedBuilder()
    .setColor(0x5865F2)
    .setDescription(chunk)
    .setFooter({ text: `${sourceLanguage} → ${targetLanguage}` }));
}

async function translate(text, targetLanguage = 'English', requestContext) {
  const access = await authorizeGrokRequest(
    requestContext.guildId,
    requestContext.channelId
  );
  if (!access.allowed) {
    const error = new Error(access.message);
    error.code = 'GROK_ACCESS_DENIED';
    throw error;
  }

  const result = await translateWithGrok(text, targetLanguage);
  return createTranslationEmbeds({ ...result, targetLanguage });
}

module.exports = { translate };
