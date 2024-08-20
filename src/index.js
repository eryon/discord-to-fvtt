import * as ChatRenderer from './ChatRenderer';
import * as listener from './listener';

export const MODULE_ID = 'discord-to-fvtt';

export const log = (message, ...args) => console.log(MODULE_ID, '|', message, ...args);

Hooks.once('setup', () => {
  game.settings.register(MODULE_ID, 'discordGuildId', {
    name: 'Discord Server ID',
    hint: 'Enter your Discord server ID.',
    config: true,
    requiresReload: false,
    scope: 'world',
    type: String
  });
  game.settings.register(MODULE_ID, 'discordChannelIds', {
    name: 'Discord Channel IDs',
    hint: 'Enter a list of channel ID filters, separated by commas. Leave this blank to relay all accessible channels.',
    config: true,
    requiresReload: false,
    scope: 'world',
    type: String,
    onChange: (value) => listener.setAcceptedChannelIds(value)
  });
  game.settings.register(MODULE_ID, 'discordToken', {
    name: 'Discord Token',
    hint: 'Enter your Discord bot token if you want to use your own bot.',
    config: true,
    requiresReload: false,
    scope: 'world',
    type: String,
    onChange: (value) => listener.init({ token: value })
  });
  game.settings.register(MODULE_ID, 'preserveDeletedMessages', {
    name: 'Preserve Messages',
    hint: 'Should deleted messages be preserved in the chat log (with a strike-through)?',
    config: true,
    requiresReload: false,
    scope: 'world',
    type: Boolean
  });

  listener.setAcceptedChannelIds(game.settings.get(MODULE_ID, 'discordChannelIds'));
  ChatRenderer.setup().catch((err) => console.error(MODULE_ID, { error: err }));
});

Hooks.once('ready', () => {
  if (!game.users.activeGM.isSelf) return;

  const token = game.settings.get(MODULE_ID, 'discordToken');

  if (!!token) {
    listener.init({ token }).catch((err) => console.error(MODULE_ID, { error: err }));
  }
});
