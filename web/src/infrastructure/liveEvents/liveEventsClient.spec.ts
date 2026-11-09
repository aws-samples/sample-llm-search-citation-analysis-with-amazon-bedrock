import {
  describe, expect, it, vi
} from 'vitest';
import { runEachTestWithFakeTimers } from '../../test/fakeTime';
import {
  ID_TOKEN, LIVE_ENDPOINTS, USER_SUB, decodedAuthHeader, fakeLiveEventsDeps
} from '../../test/fakeLiveSocket';
import {
  LINGER_MS, LiveEventsClient, MAX_RECONNECT_ATTEMPTS, RECONNECT_BASE_MS, dataEvents
} from './liveEventsClient';
import {
  deploymentChannel, userChannel
} from './liveChannels';

runEachTestWithFakeTimers();

function spyListener() {
  return {
    onEvent: vi.fn(),
    onConnected: vi.fn(),
  };
}

/** A client over fake deps (`overrides` replacing some) with one runs subscription, after its first timer turn. */
async function setupSubscribed(overrides: Parameters<typeof fakeLiveEventsDeps>[0] = {}) {
  const fake = fakeLiveEventsDeps(overrides);
  new LiveEventsClient(fake.deps).subscribe(deploymentChannel('runs'), spyListener());
  await vi.advanceTimersByTimeAsync(0);
  return fake;
}

/** A client with one subscription to `channel` whose socket AppSync accepted; the subscription is not confirmed yet. */
async function setupAccepted(channel = deploymentChannel('runs')) {
  const fake = fakeLiveEventsDeps();
  const client = new LiveEventsClient(fake.deps);
  const listener = spyListener();
  const release = client.subscribe(channel, listener);
  await vi.advanceTimersByTimeAsync(0);
  const [socket] = fake.sockets;
  socket.accept();
  await vi.advanceTimersByTimeAsync(0);
  return {
    fake,
    client,
    listener,
    release,
    socket
  };
}

async function setupConnected(channel = deploymentChannel('runs')) {
  const {
    fake, client, listener, release, socket
  } = await setupAccepted(channel);
  socket.confirmSubscriptions();
  return {
    ...fake,
    client,
    listener,
    release,
    socket 
  };
}

/** Drops the newest socket and lets its reconnect delay pass, `times` times in a row. */
async function waitForEveryConnectionToDrop(fake: ReturnType<typeof fakeLiveEventsDeps>, times: number): Promise<void> {
  if (times === 0) return;
  fake.sockets[fake.sockets.length - 1].drop();
  await vi.advanceTimersByTimeAsync(60_000);
  await waitForEveryConnectionToDrop(fake, times - 1);
}

describe('LiveEventsClient connecting', () => {
  it('connects to the real-time endpoint with the ID token in the AppSync Events subprotocols', async () => {
    const { socket } = await setupConnected();
    expect(socket.url).toBe(`wss://${LIVE_ENDPOINTS.realtimeDomain}/event/realtime`);
    expect(socket.protocols[0]).toBe('aws-appsync-event-ws');
    expect(decodedAuthHeader(socket.protocols[1])).toStrictEqual({
      host: LIVE_ENDPOINTS.httpDomain,
      Authorization: ID_TOKEN 
    });
  });

  it('subscribes after the acknowledgement, authorized with the ID token, and reports the subscription active', async () => {
    const {
      socket, listener 
    } = await setupConnected();
    expect(socket.sentOfType('connection_init')).toHaveLength(1);
    expect(socket.sentOfType('subscribe')).toStrictEqual([{
      type: 'subscribe',
      id: 'live-1',
      channel: '/deployment/runs',
      authorization: {
        host: LIVE_ENDPOINTS.httpDomain,
        Authorization: ID_TOKEN 
      },
    }]);
    expect(listener.onConnected).toHaveBeenCalledTimes(1);
  });

  it('subscribes to the signed-in user’s own channel by their sub', async () => {
    const { socket } = await setupConnected(userChannel('exports'));
    expect(socket.sentOfType('subscribe')[0].channel).toBe(`/user/${USER_SUB}/exports`);
  });
});

describe('LiveEventsClient events', () => {
  it('hands every event on the channel to its listener', async () => {
    const {
      socket, listener 
    } = await setupConnected();
    socket.publish('/deployment/runs', {
      type: 'execution.status',
      status: 'SUCCEEDED' 
    });
    expect(listener.onEvent).toHaveBeenCalledExactlyOnceWith({
      type: 'execution.status',
      status: 'SUCCEEDED' 
    });
  });

  it.each([
    ['one JSON string', '{"type":"a"}', [{ type: 'a' }]],
    ['a list of JSON strings', ['{"type":"a"}', '{"type":"b"}'], [{ type: 'a' }, { type: 'b' }]],
    ['text that is not JSON', 'nope', []],
    ['JSON without a type', '{"id":"x"}', []],
  ])('reads %s', (_case, payload, events) => {
    expect(dataEvents(payload)).toStrictEqual(events);
  });

  it('shares one subscription between two listeners of one channel and tells the second at once that it is active', async () => {
    const {
      client, socket 
    } = await setupConnected();
    const second = spyListener();
    client.subscribe(deploymentChannel('runs'), second);
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.sentOfType('subscribe')).toHaveLength(1);
    expect(second.onConnected).toHaveBeenCalledTimes(1);
  });

  it('adds a subscription for a new channel on the open socket', async () => {
    const {
      client, socket, sockets 
    } = await setupConnected();
    client.subscribe(deploymentChannel('seo'), spyListener());
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(1);
    expect(socket.sentOfType('subscribe').map((sent) => sent.channel)).toStrictEqual(['/deployment/runs', '/deployment/seo']);
  });
});

describe('LiveEventsClient releasing', () => {
  it('unsubscribes when the last listener leaves and closes the socket after the linger', async () => {
    const {
      socket, release 
    } = await setupConnected();
    release();
    expect(socket.sentOfType('unsubscribe')).toStrictEqual([{
      type: 'unsubscribe',
      id: 'live-1' 
    }]);
    await vi.advanceTimersByTimeAsync(LINGER_MS);
    expect(socket.closed).toBe(true);
  });

  it('keeps the socket for a subscription that starts within the linger', async () => {
    const {
      client, socket, release 
    } = await setupConnected();
    release();
    client.subscribe(deploymentChannel('runs'), spyListener());
    await vi.advanceTimersByTimeAsync(LINGER_MS);
    expect(socket.closed).toBe(false);
  });

  it('subscribes to nothing when released before the channel was resolved', async () => {
    const fake = fakeLiveEventsDeps();
    const release = new LiveEventsClient(fake.deps).subscribe(userChannel('exports'), spyListener());
    release();
    await vi.advanceTimersByTimeAsync(LINGER_MS);
    expect(fake.sockets).toHaveLength(0);
  });
});

describe('LiveEventsClient reconnecting', () => {
  it('reconnects after a dropped connection, subscribes again and reports it active again for a catch-up read', async () => {
    const {
      socket, sockets, listener 
    } = await setupConnected();
    socket.drop();
    await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS);
    expect(sockets).toHaveLength(2);
    sockets[1].accept();
    await vi.advanceTimersByTimeAsync(0);
    sockets[1].confirmSubscriptions();
    expect(listener.onConnected).toHaveBeenCalledTimes(2);
  });

  it('treats a connection without keep-alive for the acknowledged timeout as lost', async () => {
    const {
      socket, sockets 
    } = await setupConnected();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(socket.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS);
    expect(sockets).toHaveLength(2);
  });

  it('keeps a connection whose keep-alives arrive', async () => {
    const { socket } = await setupConnected();
    await vi.advanceTimersByTimeAsync(200_000);
    socket.frame({ type: 'ka' });
    await vi.advanceTimersByTimeAsync(200_000);
    expect(socket.closed).toBe(false);
  });

  it('stops retrying on its own after the last attempt and tries again when the page wakes', async () => {
    const fake = await setupSubscribed();
    await waitForEveryConnectionToDrop(fake, MAX_RECONNECT_ATTEMPTS + 1);
    const opened = fake.sockets.length;
    await vi.advanceTimersByTimeAsync(600_000);
    expect([opened, fake.sockets.length, fake.wakerCount()]).toStrictEqual([MAX_RECONNECT_ATTEMPTS + 1, MAX_RECONNECT_ATTEMPTS + 1, 1]);
    fake.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.sockets).toHaveLength(MAX_RECONNECT_ATTEMPTS + 2);
  });
});

describe('LiveEventsClient when live events cannot tell a view', () => {
  it('has every view read once when it gives up reconnecting, and a view that subscribes meanwhile at once', async () => {
    const fake = fakeLiveEventsDeps();
    const client = new LiveEventsClient(fake.deps);
    const first = spyListener();
    client.subscribe(deploymentChannel('runs'), first);
    await vi.advanceTimersByTimeAsync(0);
    await waitForEveryConnectionToDrop(fake, MAX_RECONNECT_ATTEMPTS + 1);
    const late = spyListener();
    client.subscribe(deploymentChannel('alerts'), late);
    await vi.advanceTimersByTimeAsync(0);

    expect([first.onConnected.mock.calls.length, late.onConnected.mock.calls.length, fake.sockets.length])
      .toStrictEqual([1, 1, MAX_RECONNECT_ATTEMPTS + 1]);
  });

  it('has the views of a subscription AppSync refused read once', async () => {
    vi.spyOn(console, 'error').mockImplementation(vi.fn());
    const {
      socket, listener
    } = await setupAccepted();

    socket.frame({
      type: 'subscribe_error',
      id: socket.sentOfType('subscribe')[0].id
    });

    expect(listener.onConnected).toHaveBeenCalledTimes(1);
  });

  it('closes a connection AppSync refused and connects again', async () => {
    vi.spyOn(console, 'error').mockImplementation(vi.fn());
    const fake = await setupSubscribed();
    const [socket] = fake.sockets;

    socket.frame({ type: 'connection_error' });
    await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS);

    expect([socket.closed, fake.sockets.length]).toStrictEqual([true, 2]);
  });
});

describe('LiveEventsClient without live events', () => {
  it('reports the subscription once so the view reads its state once, and opens nothing', async () => {
    const fake = fakeLiveEventsDeps({ endpoints: () => null });
    const listener = spyListener();
    new LiveEventsClient(fake.deps).subscribe(deploymentChannel('runs'), listener);
    await vi.advanceTimersByTimeAsync(LINGER_MS);
    expect([listener.onConnected.mock.calls.length, fake.sockets.length]).toStrictEqual([1, 0]);
  });

  it('waits for a session before it connects', async () => {
    const idToken = vi.fn<() => Promise<string | null>>().mockResolvedValueOnce(null).mockResolvedValue(ID_TOKEN);
    const fake = await setupSubscribed({ idToken });
    expect(fake.sockets).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS);
    expect(fake.sockets).toHaveLength(1);
  });
});
