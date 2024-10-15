export async function setup() {
  Hooks.on('renderChatMessage', async (message, html, speaker) => {
    if (!message.content.includes('d2fvtt-message')) return;

    html
      .find('header.message-header')
      .first()
      .prepend('<i class="fa-brands fa-discord"></i>');
  });

  await Promise.all(game.messages.map(async (message) => {
    if (message.content.includes('d2fvtt-message')) {
      return message.update();
    }
  }));
}
