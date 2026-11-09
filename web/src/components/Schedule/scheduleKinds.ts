import type {
  Schedule, ScheduleKind
} from '../../types';

/**
 * What each kind of schedule starts. Snapshot kinds call DataForSEO on every
 * run, so the form names their paid calls and saving one asks first (no
 * price is shown, as on the SEO pages' own "Snapshot now").
 */
export interface ScheduleKindInfo {
  readonly kind: ScheduleKind;
  readonly label: string;
  /** One line under the label in the "What to run" choice. */
  readonly description: string;
  /** What the generated name calls one run, after the frequency ("Weekly backlink snapshots"). */
  readonly nameNoun: string;
  /** The paid calls of one run, or null for an analysis run. */
  readonly paidCalls: string | null;
}

export const SCHEDULE_KINDS: readonly ScheduleKindInfo[] = [
  {
    kind: 'analysis',
    label: 'Analysis run',
    description: 'Asks the AI engines about your keywords and records every answer and citation.',
    nameNoun: 'analysis',
    paidCalls: null,
  },
  {
    kind: 'domain_snapshots',
    label: 'Domain traffic snapshots',
    description: 'Estimated Google traffic and top ranked keywords of your and your competitors\' domains.',
    nameNoun: 'domain snapshots',
    paidCalls: 'two paid DataForSEO calls per owned and competitor domain and market',
  },
  {
    kind: 'backlink_snapshots',
    label: 'Backlink snapshots',
    description: 'Backlink totals of your and your competitors\' domains.',
    nameNoun: 'backlink snapshots',
    paidCalls: 'one paid DataForSEO call per owned and competitor domain',
  },
];

export function scheduleKindInfo(kind: ScheduleKind | undefined): ScheduleKindInfo {
  return SCHEDULE_KINDS.find((info) => info.kind === kind) ?? SCHEDULE_KINDS[0];
}

/** A schedule's kind; answers before 2.43.0 carry none and are analysis runs. */
export function kindOf(schedule: Schedule): ScheduleKind {
  return schedule.kind ?? 'analysis';
}

/** "Each run makes one paid DataForSEO call per ...", or null for a free kind. */
export function paidRunNotice(kind: ScheduleKind): string | null {
  const calls = scheduleKindInfo(kind).paidCalls;
  return calls === null ? null : `Each run makes ${calls}.`;
}
