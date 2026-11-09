/**
 * One AWS AppSync Events WebSocket for the whole dashboard (TENETS.md tenet 8): views subscribe to channels and are
 * told when what they show changed, instead of polling its REST route.
 *
 * The protocol (https://docs.aws.amazon.com/appsync/latest/eventapi/event-api-websocket-protocol.html): connect to
 * `wss://<realtime domain>/event/realtime` with the Cognito ID token in the `header-…` subprotocol, send
 * `connection_init`, wait for `connection_ack`, then one `subscribe` per channel. AppSync sends `ka` about every
 * minute; no `ka` within `connectionTimeoutMs` means the connection is gone.
 *
 * - The socket opens with the first subscription and closes `LINGER_MS` after the last one ends, so a dashboard
 *   that watches nothing holds no connection (tenet 7: billed per connection minute).
 * - Every subscription that becomes active, the first time and after every reconnect, calls its listener's
 *   `onConnected`: the view reads its state once there, which also catches up on anything missed while it was
 *   away. Without live events configured, `onConnected` is called once and nothing more.
 * - A lost connection is opened again with jittered exponential backoff (`RECONNECT_BASE_MS` doubling to
 *   `RECONNECT_MAX_MS`), at most `MAX_RECONNECT_ATTEMPTS` times in a row; after that the next `online` or
 *   `visibilitychange` event of the page tries again.
 */
import type { LiveEventsEndpoints } from '../config/runtimeConfig';
import {
  channelPath, type LiveChannel, type LiveEvent
} from './liveChannels';

export const LINGER_MS = 10_000;
export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;
export const MAX_RECONNECT_ATTEMPTS = 8;
const DEFAULT_CONNECTION_TIMEOUT_MS = 300_000;
const PROTOCOL = 'aws-appsync-event-ws';

export interface LiveListener {
  /** An event on the channel. */
  readonly onEvent: (event: LiveEvent) => void;
  /** The subscription is active (after subscribing and after every reconnect): read the state once. */
  readonly onConnected: () => void;
}

/** The part of a browser `WebSocket` the client uses. */
export interface LiveSocket {
  send: (data: string) => void;
  close: () => void;
  onopen: ((event: Event) => void) | null;
  onmessage: ((message: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
}

export interface LiveEventsDeps {
  readonly endpoints: () => LiveEventsEndpoints | null;
  readonly idToken: () => Promise<string | null>;
  readonly userSub: () => Promise<string | null>;
  readonly openSocket: (url: string, protocols: string[]) => LiveSocket;
  /** Calls `retry` when the page comes back online or into view; returns the unsubscribe. */
  readonly onWake: (retry: () => void) => () => void;
  readonly random: () => number;
}

interface Entry {
  readonly id: string;
  readonly path: string;
  readonly listeners: Set<LiveListener>;
  active: boolean;
}

interface ServerMessage {
  readonly type: string;
  readonly id?: string;
  readonly event?: unknown;
  readonly connectionTimeoutMs?: number;
}

function isServerMessage(value: unknown): value is ServerMessage {
  return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'type') === 'string';
}

function parseJson(text: unknown): unknown {
  if (typeof text !== 'string') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isLiveEvent(value: unknown): value is LiveEvent {
  return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'type') === 'string';
}

/** The events of a `data` message: one JSON string, or (as the protocol guide shows) a list of them. */
export function dataEvents(payload: unknown): LiveEvent[] {
  const raw: unknown[] = Array.isArray(payload) ? payload : [payload];
  return raw.map(parseJson).filter(isLiveEvent);
}

function base64Url(value: object): string {
  const encoded = btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_');
  const padding = encoded.indexOf('=');
  return padding === -1 ? encoded : encoded.slice(0, padding);
}

export class LiveEventsClient {
  private readonly entries = new Map<string, Entry>();
  private socket: LiveSocket | null = null;
  private acknowledged = false;
  private connecting = false;
  private timeoutMs = DEFAULT_CONNECTION_TIMEOUT_MS;
  private nextId = 0;
  private attempts = 0;
  private keepAlive: ReturnType<typeof setTimeout> | null = null;
  private reconnect: ReturnType<typeof setTimeout> | null = null;
  private linger: ReturnType<typeof setTimeout> | null = null;
  private stopWaking: (() => void) | null = null;

  constructor(private readonly deps: LiveEventsDeps) {}

  /** Listen to `channel` until the returned function is called. */
  subscribe(channel: LiveChannel, listener: LiveListener): () => void {
    const handle = {
      released: false,
      release: (): void => undefined 
    };
    void this.pathOf(channel).then((path) => {
      if (handle.released) return;
      if (path === null) {
        listener.onConnected();
        return;
      }
      handle.release = this.add(path, listener);
    });
    return () => {
      handle.released = true;
      handle.release();
    };
  }

  private async pathOf(channel: LiveChannel): Promise<string | null> {
    if (this.deps.endpoints() === null) return null;
    if (channel.scope === 'deployment') return channelPath(channel, '');
    const sub = await this.deps.userSub();
    return sub === null ? null : channelPath(channel, sub);
  }

  private add(path: string, listener: LiveListener): () => void {
    this.clearTimer('linger');
    const existing = this.entries.get(path);
    const entry = existing ?? this.newEntry(path);
    entry.listeners.add(listener);
    if (entry.active) queueMicrotask(() => listener.onConnected());
    else if (existing === undefined && this.acknowledged) void this.sendSubscribe(entry);
    else this.ensureConnected();
    return () => this.remove(entry, listener);
  }

  private newEntry(path: string): Entry {
    this.nextId += 1;
    const entry: Entry = {
      id: `live-${this.nextId}`,
      path,
      listeners: new Set(),
      active: false 
    };
    this.entries.set(path, entry);
    return entry;
  }

  private remove(entry: Entry, listener: LiveListener): void {
    entry.listeners.delete(listener);
    if (entry.listeners.size > 0 || this.entries.get(entry.path) !== entry) return;
    this.entries.delete(entry.path);
    if (this.acknowledged) this.send({
      type: 'unsubscribe',
      id: entry.id 
    });
    if (this.entries.size === 0) this.linger = setTimeout(() => this.shutDown(), LINGER_MS);
  }

  private ensureConnected(): void {
    const idle = this.socket === null && !this.connecting && this.reconnect === null && this.stopWaking === null;
    if (idle) void this.connect();
  }

  private async connect(): Promise<void> {
    this.connecting = true;
    const endpoints = this.deps.endpoints();
    const token = await this.deps.idToken();
    this.connecting = false;
    if (endpoints === null || this.entries.size === 0 || this.socket !== null) return;
    if (token === null) {
      this.scheduleReconnect();
      return;
    }
    const header = base64Url({
      host: endpoints.httpDomain,
      Authorization: token 
    });
    const socket = this.deps.openSocket(`wss://${endpoints.realtimeDomain}/event/realtime`, [PROTOCOL, `header-${header}`]);
    this.socket = socket;
    this.acknowledged = false;
    socket.onopen = () => this.send({ type: 'connection_init' });
    socket.onmessage = (message) => this.receive(socket, message.data as unknown);
    socket.onclose = () => this.closed(socket);
    socket.onerror = () => this.closed(socket);
  }

  private receive(socket: LiveSocket, data: unknown): void {
    if (socket !== this.socket) return;
    const message = parseJson(data);
    if (!isServerMessage(message)) return;
    if (message.type === 'connection_ack') this.acknowledge(message.connectionTimeoutMs);
    else if (message.type === 'ka') this.armKeepAlive();
    else if (message.type === 'subscribe_success') this.activate(message.id);
    else if (message.type === 'data') this.deliver(message.id, message.event);
    else if (message.type.endsWith('_error')) console.error('[live events] AppSync Events answered', message.type);
  }

  private acknowledge(connectionTimeoutMs: number | undefined): void {
    this.acknowledged = true;
    this.attempts = 0;
    this.timeoutMs = connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS;
    this.armKeepAlive();
    for (const entry of this.entries.values()) void this.sendSubscribe(entry);
  }

  private armKeepAlive(): void {
    this.clearTimer('keepAlive');
    const socket = this.socket;
    this.keepAlive = setTimeout(() => {
      socket?.close();
      if (socket !== null) this.closed(socket);
    }, this.timeoutMs);
  }

  private async sendSubscribe(entry: Entry): Promise<void> {
    const endpoints = this.deps.endpoints();
    const token = await this.deps.idToken();
    if (endpoints === null || token === null || this.entries.get(entry.path) !== entry) return;
    this.send({
      type: 'subscribe',
      id: entry.id,
      channel: entry.path,
      authorization: {
        host: endpoints.httpDomain,
        Authorization: token 
      },
    });
  }

  private entryById(id: string | undefined): Entry | undefined {
    return [...this.entries.values()].find((entry) => entry.id === id);
  }

  private activate(id: string | undefined): void {
    const entry = this.entryById(id);
    if (entry === undefined) return;
    entry.active = true;
    for (const listener of [...entry.listeners]) listener.onConnected();
  }

  private deliver(id: string | undefined, payload: unknown): void {
    const entry = this.entryById(id);
    if (entry === undefined) return;
    for (const event of dataEvents(payload)) {
      for (const listener of [...entry.listeners]) listener.onEvent(event);
    }
  }

  private send(message: object): void {
    if (this.socket !== null) this.socket.send(JSON.stringify(message));
  }

  private closed(socket: LiveSocket): void {
    if (socket !== this.socket) return;
    this.socket = null;
    this.acknowledged = false;
    this.clearTimer('keepAlive');
    for (const entry of this.entries.values()) entry.active = false;
    if (this.entries.size > 0) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.attempts >= MAX_RECONNECT_ATTEMPTS) {
      this.waitForWake();
      return;
    }
    const backoff = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.attempts);
    this.attempts += 1;
    this.reconnect = setTimeout(() => {
      this.reconnect = null;
      void this.connect();
    }, backoff / 2 + this.deps.random() * (backoff / 2));
  }

  private waitForWake(): void {
    if (this.stopWaking !== null) return;
    this.stopWaking = this.deps.onWake(() => {
      this.stopWaking?.();
      this.stopWaking = null;
      this.attempts = 0;
      void this.connect();
    });
  }

  private shutDown(): void {
    this.linger = null;
    if (this.entries.size > 0) return;
    const socket = this.socket;
    this.socket = null;
    this.acknowledged = false;
    this.clearTimer('keepAlive');
    this.clearTimer('reconnect');
    this.stopWaking?.();
    this.stopWaking = null;
    socket?.close();
  }

  private clearTimer(name: 'keepAlive' | 'reconnect' | 'linger'): void {
    const timer = this[name];
    if (timer !== null) clearTimeout(timer);
    this[name] = null;
  }
}
