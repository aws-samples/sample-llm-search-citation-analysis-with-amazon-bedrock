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
  /** Default name of a new schedule of this kind. */
  readonly defaultName: string;
  /** The paid calls of one run, or null for an analysis run. */
  readonly paidCalls: string | null;
}

export const SCHEDULE_KINDS: readonly ScheduleKindInfo[] = [
  {
    kind: 'analysis',
    label: 'Analysis run',
    defaultName: '',
    paidCalls: null,
  },
  {
    kind: 'domain_snapshots',
    label: 'Domain traffic snapshots',
    defaultName: 'Weekly domain snapshots',
    paidCalls: 'two paid DataForSEO calls per owned and competitor domain and market',
  },
  {
    kind: 'backlink_snapshots',
    label: 'Backlink snapshots',
    defaultName: 'Weekly backlink snapshots',
    paidCalls: 'one paid DataForSEO call per owned and competitor domain',
  },
];

export function scheduleKindInfo(kind: ScheduleKind | undefined): ScheduleKindInfo {
  return SCHEDULE_KINDS.find((info) => info.kind === kind) ?? SCHEDULE_KINDS[0];
}

export function isScheduleKind(value: string): value is ScheduleKind {
  return SCHEDULE_KINDS.some((info) => info.kind === value);
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
