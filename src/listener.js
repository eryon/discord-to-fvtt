import OpCodes from './DiscordOpCodes';
import { log, MODULE_ID } from './index';

export async function init({ token }) {
  close();
  client = buildClient({ url: 'wss://gateway.discord.gg', token });
}

export function setAcceptedChannelIds(value) {
  if (!!value) acceptedChannelIds = value.split(',');
  else acceptedChannelIds = [];
}

const config = {
  encoding: 'json',
  version: 10
};
const initialState = {
  heartbeatAcknowledged: false,
  heartbeatInterval: -1,
  gatewayUrl: '',
  sessionId: '',
  seq: null,
  status: 'closed'
};

let acceptedChannelIds = [];
let client;
let clientState = {};

function buildClient({ url, token }) {
  const ws = new WebSocket(`${url}/?v=${config.version}&encoding=${config.encoding}`);
  ws.addEventListener('open', () => {
    clientState = {
      ...initialState,
      gatewayUrl: ws.url,
      token,
      status: 'open'
    };
  });
  ws.addEventListener('close', onClose);
  ws.addEventListener('error', onError);
  ws.addEventListener('message', onMessageReceived);

  return ws;
}

function close(code = 1000, reason = '') {
  if (clientState.hb) {
    clearInterval(clientState.hb);
  }

  client?.removeEventListener('close', onClose);
  client?.removeEventListener('error', onError);
  client?.removeEventListener('message', onMessageReceived);
  client?.close(code, reason);
}

function getRenderContent(message) {
  return `<div class="d2fvtt-message">
      <small>${clientState.channels[message.guild_id][message.channel_id]?.name}</small>
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

function isValidGuildChannel({ channel_id, guild_id }) {
  if (guild_id !== game.settings.get(MODULE_ID, 'discordGuildId')) return false;

  return acceptedChannelIds.length === 0 || !!acceptedChannelIds.includes(channel_id);
}

function onClose(data) {
  log('Connection closed', data);
  close();

  if (data.code === 1006) {
    resume(false);
  }
}

function onError(data) {
  log('Connection error', data);
}

async function onMessageReceived({ data }) {
  log('Received message', JSON.parse(data));
  const { d, op, s, t } = JSON.parse(data);

  switch (op) {
    case OpCodes.Hello:
      clientState.heartbeatInterval = d.heartbeat_interval;

      setTimeout(() => {
        sendHeartbeat();
        clientState.hb = setInterval(sendHeartbeat, clientState.heartbeatInterval);
      }, 250 /*clientState.heartbeatInterval * Math.random()*/);

      break;
    case OpCodes.Heartbeat:
      sendHeartbeat();
      break;
    case OpCodes.HeartbeatAck:
      clientState.heartbeatAcknowledged = true;

      if (clientState.status === 'open') {
        sendIdentify();
      }

      break;
    case OpCodes.InvalidSession:
      if (!d) await init({ token: clientState.token });
      else resume();

      break;
    case OpCodes.Ready:
      if (t === 'READY') {
        clientState.gatewayUrl = d.resume_gateway_url ?? clientState.gatewayUrl;
        clientState.sessionId = d.session_id ?? clientState.sessionId;
        clientState.seq = s ?? clientState.seq;
        clientState.status = 'ready';
      }

      break;
    case OpCodes.Reconnect:
      resume();
      break;
  }

  if (clientState.status !== 'ready') return;

  if (t === 'GUILD_CREATE') {
    onGuildCreate(d);
  } else {
    if (!d || !isValidGuildChannel(d)) return;

    switch (t) {
      case 'MESSAGE_CREATE':
        await onMessageCreated(d);
        break;
      case 'MESSAGE_UPDATE':
        await onMessageUpdated(d);
        break;
      case 'MESSAGE_DELETE':
        await onMessageDeleted(d);
        break;
    }
  }
}

function onGuildCreate(data) {
  clientState.channels ??= {};
  clientState.channels[data.id] = data.channels
    .filter((c) => c.type === 0)
    .reduce((curr, val) => ({ ...curr, [val.id]: { name: val.name, type: val.type } }), {});
}

async function onMessageCreated(data) {
  return ChatMessage.create({
    content: getRenderContent(data),
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

async function onMessageDeleted(data) {
  const msg = game.messages.find((m) => m.getFlag(MODULE_ID, 'messageId') === data.id);

  if (msg) {
    if (!!game.settings.get(MODULE_ID, 'preserveDeletedMessages')) {
      await msg.update({
        content: msg.content.replace('class="d2fvtt-message"', 'class="d2fvtt-message deleted"')
      });
    } else {
      await msg.delete();
    }
  }
}

async function onMessageUpdated(data) {
  const msg = game.messages.find((m) => m.getFlag(MODULE_ID, 'messageId') === data.id);

  if (msg) {
    await msg.update({ content: getRenderContent(data) });
  }
}

function resume(closeFirst = true) {
  if (closeFirst) {
    close(3000, 'resume');
  }

  client = buildClient({ resume: true, url: clientState.gatewayUrl, token: clientState.token });
  client.addEventListener('open', sendResume);
}

function sendHeartbeat() {
  if (client && client.readyState === WebSocket.OPEN) {
    if (clientState.status === 'ready' && !clientState.heartbeatAcknowledged) {
      close();
      resume();
    } else {
      clientState.heartbeatAcknowledged = false;
      client.send(JSON.stringify({ op: OpCodes.Heartbeat, d: clientState.seq }));
    }
  }
}

function sendIdentify() {
  client.send(
    JSON.stringify({
      op: OpCodes.Identify,
      d: {
        intents: (1 << 0) | (1 << 9) | (1 << 15),
        properties: {
          browser: window.navigator.userAgent,
          device: 'DiscordToFVTT'
        },
        token: clientState.token
      }
    })
  );
}

function sendResume() {
  client.removeEventListener('open', sendResume);
  client.send(
    JSON.stringify({
      op: OpCodes.Resume,
      d: {
        session_id: clientState.sessionId,
        seq: clientState.seq,
        token: clientState.token
      }
    })
  );
}
