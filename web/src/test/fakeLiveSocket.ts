import { vi } from 'vitest';
import type {
  LiveEventsDeps, LiveSocket
} from '../infrastructure/liveEvents/liveEventsClient';

export const LIVE_ENDPOINTS = {
  httpDomain: 'abc123.appsync-api.eu-west-1.amazonaws.com',
  realtimeDomain: 'abc123.appsync-realtime-api.eu-west-1.amazonaws.com',
};
export const ID_TOKEN = 'id-token-1';
export const USER_SUB = '3f1c2a4e-9b7d-4e21-8a55-0c6d2f1e9a10';

/** A WebSocket the spec drives: what the client sent, and server frames on demand. */
export class FakeLiveSocket implements LiveSocket {
  readonly sent: Record<string, unknown>[] = [];
  closed = false;
  onopen: LiveSocket['onopen'] = null;
  onmessage: LiveSocket['onmessage'] = null;
  onclose: LiveSocket['onclose'] = null;
  onerror: LiveSocket['onerror'] = null;

  constructor(readonly url: string, readonly protocols: string[]) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(): void {
    this.closed = true;
  }

  /** The server accepts the socket and the `connection_init`. */
  accept(connectionTimeoutMs = 300_000): void {
    this.onopen?.(new Event('open'));
    this.frame({
      type: 'connection_ack',
      connectionTimeoutMs 
    });
  }

  frame(message: object): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(message) }));
  }

  /** The server confirms every subscribe sent so far. */
  confirmSubscriptions(): void {
    for (const message of this.sent.filter((sent) => sent.type === 'subscribe')) {
      this.frame({
        type: 'subscribe_success',
        id: message.id 
      });
    }
  }

  /** An event on the subscription for `channel`. */
  publish(channel: string, event: object): void {
    const subscription = this.sent.find((sent) => sent.type === 'subscribe' && sent.channel === channel);
    this.frame({
      type: 'data',
      id: subscription?.id,
      event: JSON.stringify(event) 
    });
  }

  drop(): void {
    this.onclose?.(new CloseEvent('close'));
  }

  sentOfType(type: string): Record<string, unknown>[] {
    return this.sent.filter((sent) => sent.type === type);
  }
}

/** Client dependencies whose sockets the spec reads from `sockets`, and whose wake-up it fires with `wake`. */
export function fakeLiveEventsDeps(overrides: Partial<LiveEventsDeps> = {}) {
  const sockets: FakeLiveSocket[] = [];
  const wakers: (() => void)[] = [];
  const deps: LiveEventsDeps = {
    endpoints: () => LIVE_ENDPOINTS,
    idToken: () => Promise.resolve(ID_TOKEN),
    userSub: () => Promise.resolve(USER_SUB),
    openSocket: vi.fn((url: string, protocols: string[]) => {
      const socket = new FakeLiveSocket(url, protocols);
      sockets.push(socket);
      return socket;
    }),
    onWake: (retry) => {
      wakers.push(retry);
      return () => {
        wakers.splice(wakers.indexOf(retry), 1);
      };
    },
    random: () => 0.5,
    ...overrides,
  };
  return {
    deps,
    sockets,
    wake: () => [...wakers].forEach((retry) => retry()),
    wakerCount: () => wakers.length,
  };
}

/** The `{host, Authorization}` object of a `header-<base64url JSON>` subprotocol. */
export function decodedAuthHeader(protocol: string): unknown {
  const base64 = protocol.slice('header-'.length).replaceAll('-', '+').replaceAll('_', '/');
  return JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
}
