/**
 * The live events channels (`CitationAnalysisEventsStack`, `lambda/live-events/live_channel_routes.py`).
 *
 * - `deployment` channels (`/deployment/<topic>`) carry changes to state every signed-in user may read through
 *   the API: runs, research jobs, Content Studio, ranking analyses and narratives, view jobs, snapshots, alerts and
 *   SEO jobs. Any signed-in user may subscribe.
 * - `user` channels (`/user/<sub>/<topic>`) carry changes only their owner may read (exports). The server refuses
 *   a subscription to any other user's channel.
 *
 * An event names what changed (ids, a status) and nothing more; the view reads the state from its REST route.
 */

export type DeploymentTopic =
  | 'runs'
  | 'research'
  | 'content-studio'
  | 'insights'
  | 'view-jobs'
  | 'snapshots'
  | 'alerts'
  | 'seo';

export type UserTopic = 'exports';

export type LiveChannel =
  | {
    readonly scope: 'deployment';
    readonly topic: DeploymentTopic 
  }
  | {
    readonly scope: 'user';
    readonly topic: UserTopic 
  };

/** One event on a channel: its `type` (the EventBridge detail-type) and the ids and status it names. */
export interface LiveEvent {
  readonly type: string;
  readonly [field: string]: unknown;
}

export function deploymentChannel(topic: DeploymentTopic): LiveChannel {
  return {
    scope: 'deployment',
    topic 
  };
}

export function userChannel(topic: UserTopic): LiveChannel {
  return {
    scope: 'user',
    topic 
  };
}

/** The channel path; a `user` channel needs the signed-in user's Cognito `sub`. */
export function channelPath(channel: LiveChannel, userSub: string): string {
  return channel.scope === 'deployment' ? `/deployment/${channel.topic}` : `/user/${userSub}/${channel.topic}`;
}

/** The string field `name` of `event`, or `undefined`. */
export function eventField(event: LiveEvent, name: string): string | undefined {
  const value = event[name];
  return typeof value === 'string' ? value : undefined;
}
