/**
 * The tab a key moves to in a horizontal tab list (WAI-ARIA tabs pattern):
 * arrows wrap around, Home and End jump to the ends. `null` for other keys.
 */
export function nextTabIndex(key: string, current: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
      return (current + 1) % count;
    case 'ArrowLeft':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
