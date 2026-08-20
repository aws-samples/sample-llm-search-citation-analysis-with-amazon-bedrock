export const formatDate = (dateString: string | null | undefined): string => {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Invalid date';
    return date.toLocaleString();
  } catch (error: unknown) {
    console.warn('Date parsing failed:', error);
    return 'Invalid date';
  }
};

export const formatDateOnly = (dateString: string | null | undefined): string => {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Invalid date';
    return date.toLocaleDateString();
  } catch (error: unknown) {
    console.warn('Date parsing failed:', error);
    return 'Invalid date';
  }
};

export const formatTime = (dateString: string | null | undefined): string => {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Invalid time';
    return date.toLocaleTimeString();
  } catch (error: unknown) {
    console.warn('Time parsing failed:', error);
    return 'Invalid time';
  }
};

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;

/** Anything more recent than this reads as "just now" rather than "12 seconds ago". */
const JUST_NOW_THRESHOLD_SECONDS = 45;

interface DurationUnit {
  seconds: number;
  label: string;
}

const DURATION_UNITS: DurationUnit[] = [
  {
    seconds: SECONDS_PER_DAY,
    label: 'day',
  },
  {
    seconds: SECONDS_PER_HOUR,
    label: 'hour',
  },
  {
    seconds: SECONDS_PER_MINUTE,
    label: 'minute',
  },
  {
    seconds: 1,
    label: 'second',
  },
];

const SMALLEST_DURATION_UNIT: DurationUnit = {
  seconds: 1,
  label: 'second',
};

/**
 * Coarse, single-unit duration for humans: `4434821` becomes `51 days`.
 *
 * Unlike `calculateDuration` this drops the smaller units entirely, which is
 * what you want when the number came off the wire and its precision is
 * meaningless (a run stranded for seven weeks does not need its seconds).
 */
export const formatApproximateDuration = (totalSeconds: number): string => {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return 'an unknown time';

  const wholeSeconds = Math.floor(totalSeconds);
  const unit = DURATION_UNITS.find((candidate) => wholeSeconds >= candidate.seconds)
    ?? SMALLEST_DURATION_UNIT;
  const count = Math.floor(wholeSeconds / unit.seconds);

  return count === 1 ? `1 ${unit.label}` : `${count} ${unit.label}s`;
};

/**
 * How long ago a timestamp was, e.g. `2 hours ago`. Future timestamps and
 * anything within the last minute collapse to `just now`.
 */
export const formatRelativeTime = (dateString: string | null | undefined): string => {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Invalid date';

    const elapsedSeconds = (Date.now() - date.getTime()) / 1000;
    if (elapsedSeconds < JUST_NOW_THRESHOLD_SECONDS) return 'just now';

    return `${formatApproximateDuration(elapsedSeconds)} ago`;
  } catch (error: unknown) {
    console.warn('Relative time formatting failed:', error);
    return 'Invalid date';
  }
};

export const calculateDuration = (
  startDate: string | null | undefined,
  stopDate?: string | null
): string | null => {
  if (!startDate) return null;
  try {
    const start = new Date(startDate);
    const end = stopDate ? new Date(stopDate) : new Date();
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;

    const diffMs = end.getTime() - start.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);

    if (diffHours > 0) {
      return `${diffHours}h ${diffMins % 60}m ${diffSecs % 60}s`;
    } else if (diffMins > 0) {
      return `${diffMins}m ${diffSecs % 60}s`;
    } else {
      return `${diffSecs}s`;
    }
  } catch (error: unknown) {
    console.warn('Duration calculation failed:', error);
    return null;
  }
};
