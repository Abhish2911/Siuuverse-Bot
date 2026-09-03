const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder
} = require('discord.js');
const E = require('../utils/emojis');

const TOPICS = {
  overview: { label: 'Overview', description: 'Start here: the game at a glance.' },
  modes: { label: 'Game modes', description: 'Royale and 4v4 explained.' },
  gameplay: { label: 'How a round works', description: 'Shooting, predicting, saves, and shields.' },
  abilities: { label: 'Secret abilities', description: 'Every ability and how players earn them.' },
  chaos: { label: 'Chaos modes', description: 'Golden, Sudden Death, and Blind Penalty.' },
  commands: { label: 'Command reference', description: 'Every Penalty Royale command.' }
};

function createEmbed(topic) {
  const embed = new EmbedBuilder().setColor(0xF1C40F).setTimestamp();

  if (topic === 'modes') {
    return embed
      .setTitle(`${E.team} PENALTY ROYALE — GAME MODES`)
      .setDescription('Create a lobby with `.prcreate [royale|teams] [settings]`. Lobbies automatically cancel if the host does not start them within 10 minutes.')
      .addFields(
        {
          name: `${E.trophy} Royale — 2 to 8 players`,
          value: `Everyone begins with configurable ${E.prHeart} lives (**3 by default**). Each round has one rotating **goalkeeper** plus predictors. Only the goalkeeper can save the shot; predictors earn points for correct calls. If the shooter has no ${E.prShield} shield, a GK save costs one life. Last player standing wins.\n\n**Create examples:** \`.prcreate royale\` (3 lives, 30s) • \`.prcreate royale 5 45\` (5 lives, 45s per choice)`,
          inline: false
        },
        {
          name: `${E.team} 4v4 Teams`,
          value: `Exactly four players join **Team A** and four join **Team B**. The defending team has one rotating goalkeeper plus three predictors. Each player takes one penalty; the team with the most goals wins.\n\nA level score triggers a **sudden-death tiebreaker**: teams keep taking equal penalties until one team leads after both have taken the same number of tiebreaker shots.\n\n**Create example:** \`.prcreate teams 45\` (45s per choice).`,
          inline: false
        }
      )
      .setFooter({ text: 'Use the menu to read another topic' });
  }

  if (topic === 'gameplay') {
    return embed
      .setTitle(`${E.goal} PENALTY ROYALE — HOW A ROUND WORKS`)
      .setDescription('A **shot corner** is the direction the shooter selects: Left, Center, or Right.')
      .addFields(
        {
          name: `1. ${E.scorer} Shooter chooses`,
          value: 'The current shooter picks Left, Center, or Right with a private button. The choice is hidden until the round resolves.',
          inline: false
        },
        {
          name: `2. ${E.goalkeeper} GK & predictors choose`,
          value: 'One defender is the rotating **goalkeeper**. Everyone else is a predictor. They all choose the corner they think the shooter selected; choices stay private until the result.',
          inline: false
        },
        {
          name: `3. Result`,
          value: `${E.goal} **Goal:** the goalkeeper chose the wrong corner. Correct predictors still earn **+1 Prediction Point**.\n${E.save} **Saved:** only the goalkeeper’s correct choice saves the shot. The GK earns a save and ${E.prShield} shield; correct predictors still earn **+1 Prediction Point**.\n${E.prShield} In Royale, a shield blocks one life loss before being consumed.`,
          inline: false
        },
        {
          name: `${E.prTimer} Timers`,
          value: 'The host chooses **10–120 seconds** per choice at lobby creation (30 seconds by default). A shooter who times out gets a random corner. Missing defenders count as no prediction when their timer expires. The host can also use `.prresolve`.',
          inline: false
        }
      )
      .setFooter({ text: 'Use the menu to read another topic' });
  }

  if (topic === 'abilities') {
    return embed
      .setTitle(`${E.prAbility} PENALTY ROYALE — SECRET ABILITIES`)
      .setDescription('Every player receives **one random secret ability** by DM when the match starts. Extra abilities are earned only for a streak of **3 personal goals**, **3 goalkeeper saves**, or **3 correct predictor calls** in a row.')
      .addFields(
        { name: `${E.prRead} Read`, value: 'While predicting, privately reveals one corner the shooter did not choose.', inline: true },
        { name: `${E.save} Super Save`, value: 'For the assigned goalkeeper, locks in a guaranteed save.', inline: true },
        { name: `${E.prPrecision} Precision`, value: 'Before shooting, ignores the goalkeeper’s correct read.', inline: true },
        { name: `${E.prFakeShot} Fake Shot`, value: 'Before shooting, displays a false corner to defenders.', inline: true },
        { name: `${E.prRebound} Rebound`, value: 'Before shooting, lets a surviving shooter try again after a save.', inline: true },
        {
          name: `${E.prAbility} Managing abilities`,
          value: '`.prabilities` — DM your private inventory\n`.prgiveability [@player|all]` / `.prga` — Host gives random abilities\n`.prrerollability @player` — Host rerolls before Round 1 resolves',
          inline: false
        }
      )
      .setFooter({ text: 'Use the menu to read another topic' });
  }

  if (topic === 'chaos') {
    return embed
      .setTitle(`${E.prGolden} PENALTY ROYALE — CHAOS MODES`)
      .setDescription('Host/server manager: `.prchaos [golden|sudden|blind|random]`. Choose in the lobby for the **full match**, or during shooting for the current round only.')
      .addFields(
        { name: `${E.prGolden} Golden Penalty`, value: 'Every successful penalty counts as **2 goals**.', inline: false },
        { name: `${E.prSudden} Sudden Death — Royale only`, value: `A saved shot immediately eliminates the shooter. ${E.prShield} Shields cannot prevent it.`, inline: false },
        { name: `${E.prBlind} Blind Penalty`, value: 'Public GOAL/SAVED results hide the shooter’s corner, preventing pattern-reading. Every defender receives an ephemeral private confirmation of their own prediction.', inline: false },
        { name: `${E.prGolden} Random`, value: 'Randomly selects an eligible chaos mode. Sudden Death is excluded in 4v4 Teams.', inline: false }
      )
      .setFooter({ text: 'Use the menu to read another topic' });
  }

  if (topic === 'commands') {
    return embed
      .setTitle(`${E.lock} PENALTY ROYALE — COMMAND REFERENCE`)
      .addFields(
        {
          name: `${E.goal} Lobby & match`,
          value: '`.prcreate [royale|teams] [settings]` — Create lobby\n`.prcreate royale 5 45` — 5 lives, 45s per choice\n`.prcreate teams 45` — 4v4 with 45s per choice\n`.prjoin [A|B]` — Join lobby\n`.prstart` — Host starts\n`.prstatus` — Current board\n`.prresolve` — Host resolves a stalled round\n`.prcancel` — Host, server admin, or bot owner cancels without stats',
          inline: false
        },
        { name: `${E.prGolden} Chaos`, value: '`.prchaos [golden|sudden|blind|random]` — Select lobby match mode or a current-round effect.', inline: false },
        { name: `${E.prAbility} Abilities`, value: '`.prabilities` — DM your inventory\n`.prgiveability [@player|all]` / `.prga` — Host gives abilities\n`.prrerollability @player` — Host rerolls before Round 1 resolves', inline: false },
        { name: `${E.profile} Stats`, value: '`.myprstats [@player]` — Profile and records\n`.prleaderboard [wins|goals|saves|predictions|predictionpoints|streak|goalstreak|savestreak|predictionstreak|abilities]` — Server rankings', inline: false }
      )
      .setFooter({ text: 'Host means the lobby creator or a server manager' });
  }

  return embed
    .setTitle(`${E.trophy} PENALTY ROYALE — HELP CENTRE`)
    .setDescription(`${E.goal} A fast football party game for **2–8 players**. Outsmart defenders, make your saves count, and win the shootout.`)
    .addFields(
      { name: `${E.team} Pick a topic below`, value: 'Read the full rules one section at a time: game modes, round flow, secret abilities, chaos modes, or commands.', inline: false },
      { name: `${E.goal} Quick start`, value: '1. `.prcreate royale` or `.prcreate teams`\n2. Players use `.prjoin` or lobby buttons\n3. Host may choose `.prchaos <mode>`\n4. Host uses `.prstart` within 10 minutes', inline: false }
    )
    .setFooter({ text: 'Choose a guide section from the dropdown' });
}

function buildHelpPayload(topic = 'overview') {
  const currentTopic = TOPICS[topic] ? topic : 'overview';
  const menu = new StringSelectMenuBuilder()
    .setCustomId('prhelp_topic')
    .setPlaceholder('Choose a Penalty Royale guide topic')
    .addOptions(Object.entries(TOPICS).map(([value, item]) => ({
      label: item.label,
      description: item.description,
      value,
      default: value === currentTopic
    })));

  return {
    embeds: [createEmbed(currentTopic)],
    components: [new ActionRowBuilder().addComponents(menu)]
  };
}

module.exports = {
  name: 'prhelp',
  aliases: ['penaltyhelp'],

  async execute(message) {
    return message.reply(buildHelpPayload());
  },

  async buttonHandler(interaction) {
    return buildHelpPayload(interaction.values?.[0]);
  },

  buildHelpPayload
};
