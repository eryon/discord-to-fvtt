export async function setup() {
  Hooks.on('renderChatMessage', async (message, html, speaker) => {
    if (!message.content.includes('d2fvtt-message')) return;

    const el = document.createElement('i');
    el.classList.add('fa-brands', 'fa-discord');
    el.title = html.find('.d2fvtt-message').attr('data-discord-channel');

    html
      .find('header.message-header')
      .first()
      .prepend(el);
  });

  await Promise.all(game.messages.map(async (message) => {
    if (message.content.includes('d2fvtt-message')) {
      return message.update();
    }
  }));
}
