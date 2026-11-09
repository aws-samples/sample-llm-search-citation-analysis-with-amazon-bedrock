import {
  useEffect, useState
} from 'react';
import { calculateDuration } from '../../formatting/dateFormatter';

/**
 * How long a run has taken ("3m 12s"): to its stop date once it has one,
 * otherwise to now, redrawn every second while it runs. The tick is a local
 * clock only; the run's status still comes from the status poll.
 */
export function useRunDuration(startDate: string, stopDate: string | undefined, isRunning: boolean): string | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isRunning) return undefined;
    const timer = setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => clearInterval(timer);
  }, [isRunning]);
  return calculateDuration(startDate, stopDate);
}
