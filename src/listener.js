import OpCodes from './DiscordOpCodes';
import { log, MODULE_ID } from './index';

const config = {
  encoding: 'json',
  gatewayUrl: 'wss://gateway.discord.gg',
  version: 10
};
const State = {
  Closed: 'closed',
  Established: 'established',
  Open: 'open'
};

export class Listener extends EventTarget {
  #client;

  #initialState = {
    heartbeatAcknowledged: true,
    heartbeatInterval: -1,
    gatewayUrl: '',
    sessionId: '',
    seq: null,
    status: State.Closed
  };

  #toggleControl = {
    active: false,
    toggle: true,
    icon: 'fa-brands fa-discord',
    name: 'discord',
    title: `${MODULE_ID}.name`,
    onClick: this.onToolbarToggle.bind(this)
  };

  set acceptedChannels(value) {
    if (!!value) this.acceptedChannelIds = value.split(',');
    else this.acceptedChannelIds = [];
  }

  set token(value) {
    this.close();

    if (value) {
      this.#client = this.buildClient({ url: config.gatewayUrl, token: value });
    }
  }

  constructor() {
    super();

    this.acceptedChannels = game.settings.get(MODULE_ID, 'discordChannelIds');
    this.clientState = { ...this.#initialState };

    Hooks.on('getSceneControlButtons', this.addToggleControlBtn.bind(this));
  }

  addToggleControlBtn(controls) {
    if (!game.user.isGM) return;

    const bar = controls.find((c) => c.name === 'token');
    bar?.tools.push(this.#toggleControl);
  }

  buildClient({ url, token }) {
    const ws = new WebSocket(`${url}/?v=${config.version}&encoding=${config.encoding}`);
    ws.addEventListener('open', () => {
      this.clientState = {
        ...this.#initialState,
        gatewayUrl: ws.url,
        token,
        status: State.Open
      };
    });
    ws.addEventListener('close', this.onClose.bind(this));
    ws.addEventListener('error', this.onError.bind(this));
    ws.addEventListener('message', this.onReceive.bind(this));

    return ws;
  }

  close(code = 1000, reason = '') {
    if (this.clientState.hb) {
      clearInterval(this.clientState.hb);
    }

    this.#client?.removeEventListener('close', this.onClose);
    this.#client?.removeEventListener('error', this.onError);
    this.#client?.removeEventListener('message', this.onReceive);
    this.#client?.close(code, reason);

    this.clientState = { ...this.#initialState };

    this.#toggleControl.active = false;
    ui.controls.render();
  }

  isValidGuildChannel({ channel_id, guild_id }) {
    if (guild_id !== game.settings.get(MODULE_ID, 'discordGuildId')) return false;

    return this.acceptedChannelIds.length === 0 || !!this.acceptedChannelIds.includes(channel_id);
  }

  onClose(data) {
    log('Connection closed', data);
    this.close();

    if (data.code === 1006) {
      this.resume(false);
    }
  }

  onError(data) {
    log('Connection error', data);
  }

  onReceive({ data }) {
    return new Promise((resolve, reject) => {
      this._onReceive(JSON.parse(data))
        .then(resolve)
        .catch((err) => {
          log('WS receive error', err);
          reject(err);
        });
    });
  }

  onToolbarToggle(value) {
    if (value) {
      this.#client = this.buildClient({ url: config.gatewayUrl, token: game.settings.get(MODULE_ID, 'discordToken') });
    } else {
      this.close();
    }

    this.#toggleControl.active = value;
    ui.controls.render();
  }

  resume(closeFirst = true) {
    if (closeFirst) {
      this.close(3000, 'resume');
    }

    this.#client = this.buildClient({ resume: true, url: this.clientState.gatewayUrl, token: this.clientState.token });
    this.#client.addEventListener('open', this._sendResume.bind(this));
  }

  _destroy() {
    Hooks.off('getSceneControlButtons', this.addToggleControlBtn);
  }

  _getRenderContent(message) {
    const mentions = message.content.matchAll(/(?:<[#@](\d+)>)+/g);
    const channels = this.clientState.channels[message.guild_id];
    const members = this.clientState.members[message.guild_id];

    for (const mention of mentions) {
      const type = mention[0][1];

      if (type === '@' && members[mention[1]]) {
        message.content = message.content.replace(mention[0], `<u>@${members[mention[1]].display}</u>`);
      } else if(type === '#' && channels[mention[1]]) {
        message.content = message.content.replace(mention[0], `<u>#${channels[mention[1]].name}</u>`);
      }
    }

    return `<div class="d2fvtt-message">
      <small>${this.clientState.channels[message.guild_id][message.channel_id]?.name}</small>
      ${message.attachments.map((a) => {
        if (a.content_type?.startsWith('video')) {
          return `<video controls muted><source src="${a.url}" type="${a.content_type}"/></video>`;
        } else if (a.content_type?.startsWith('image')) {
          return `<img alt="${a.filename}" src="${a.url}"/>`;
        }

        return `<a href="${a.url}">${a.filename}</a>`;
      })}
      ${message.content ? `<p>${message.content}</p>` : ''}
    </div>`;
  }

  _onGuildJoin(data) {
    this.clientState.channels ??= {};
    this.clientState.channels[data.id] = data.channels
      .filter((c) => c.type === 0)
      .reduce((curr, val) => ({ ...curr, [val.id]: { name: val.name, type: val.type } }), {});

    this.clientState.members ??= {};
    this.clientState.members[data.id] = data.members
      .filter((u) => !u.pending)
      .reduce(
        (curr, val) => ({
          ...curr,
          [val.user.id]: {
            avatarId: val.avatar ?? val.user.avatar,
            display: val.nick ?? val.user.display_name ?? val.user.username,
            username: val.user.username
          }
        }),
        {}
      );
  }

  async _onMessageCreated(data) {
    return ChatMessage.create({
      content: this._getRenderContent(data),
      flags: {
        [MODULE_ID]: {
          managed: true,
          messageId: data.id
        }
      },
      speaker: { alias: data.member.nick ?? data.author.username },
      style: 1
    });
  }

  async _onMessageDeleted(data) {
    const msg = game.messages.find((m) => m.getFlag(MODULE_ID, 'messageId') === data.id);
    if (!msg) return Promise.resolve();

    return !!game.settings.get(MODULE_ID, 'preserveDeletedMessages')
      ? msg.update({
          content: msg.content.replace('class="d2fvtt-message"', 'class="d2fvtt-message deleted"')
        })
      : msg.delete();
  }

  async _onMessageUpdated(data) {
    const msg = game.messages.find((m) => m.getFlag(MODULE_ID, 'messageId') === data.id);
    if (!msg) return Promise.resolve();

    return msg.update({ content: this._getRenderContent(data) });
  }

  async _onReceive(data) {
    log('Received message', data);
    const { d, op, s, t } = data;

    switch (op) {
      case OpCodes.Hello:
        this.clientState.heartbeatInterval = d.heartbeat_interval;

        setTimeout(() => {
          this._sendHeartbeat();
          this.clientState.hb = setInterval(this._sendHeartbeat.bind(this), this.clientState.heartbeatInterval);
        }, this.clientState.heartbeatInterval * Math.random());

        this._sendIdentify();

        break;
      case OpCodes.Heartbeat:
        this._sendHeartbeat();
        break;
      case OpCodes.HeartbeatAck:
        this.clientState.heartbeatAcknowledged = true;

        if (this.clientState.status === 'open') {
          this._sendIdentify();
        }

        break;
      case OpCodes.InvalidSession:
        if (!d) {
          this.close();
          this.#client = this.buildClient({ url: config.gatewayUrl, token: this.clientState.token });
        } else {
          this.resume();
        }

        break;
      case OpCodes.Ready:
        if (t === 'READY') {
          this.clientState.gatewayUrl = d.resume_gateway_url ?? this.clientState.gatewayUrl;
          this.clientState.sessionId = d.session_id ?? this.clientState.sessionId;
          this.clientState.seq = s ?? this.clientState.seq;
          this.clientState.status = 'ready';

          this.#toggleControl.active = true;
          ui.controls.render();
        }

        break;
      case OpCodes.Reconnect:
        this.resume();
        break;
    }

    if (this.clientState.status !== 'ready') return;

    if (t === 'GUILD_CREATE') {
      this._onGuildJoin(d);
    } else {
      if (!d || !this.isValidGuildChannel(d)) return;

      switch (t) {
        case 'MESSAGE_CREATE':
          return this._onMessageCreated(d);
        case 'MESSAGE_UPDATE':
          return this._onMessageUpdated(d);
        case 'MESSAGE_DELETE':
          return this._onMessageDeleted(d);
      }
    }
  }

  _sendHeartbeat() {
    if (this.#client && this.#client.readyState === WebSocket.OPEN) {
      if (this.clientState.status === 'ready' && !this.clientState.heartbeatAcknowledged) {
        this.close();
        this.resume();
      } else {
        this.clientState.heartbeatAcknowledged = false;
        this.#client.send(JSON.stringify({ op: OpCodes.Heartbeat, d: this.clientState.seq }));
      }
    }
  }

  _sendIdentify() {
    this.#client.send(
      JSON.stringify({
        op: OpCodes.Identify,
        d: {
          intents: (1 << 0) | (1 << 8) | (1 << 9) | (1 << 15),
          properties: {
            browser: window.navigator.userAgent,
            device: 'DiscordToFVTT'
          },
          token: this.clientState.token
        }
      })
    );
  }

  _sendResume() {
    this.#client.removeEventListener('open', this._sendResume);
    this.#client.send(
      JSON.stringify({
        op: OpCodes.Resume,
        d: {
          session_id: this.clientState.sessionId,
          seq: this.clientState.seq,
          token: this.clientState.token
        }
      })
    );
  }
}
