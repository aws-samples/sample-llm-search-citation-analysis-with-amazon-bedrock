type Priority = 'high' | 'medium' | 'low';

interface Props {
  readonly priority: Priority;
  /**
   * Table cells render the badge inline; card headers place it inside a
   * flex row where it must keep its width when the title wraps.
   */
  readonly inline?: boolean;
}

/**
 * High / medium / low pill shared by the outreach, brief and recommendation
 * lists so a reader learns the colour code once and can reuse it across
 * every report.
 */
export function PriorityBadge({
  priority, inline = false 
}: Props) {
  const styles = priorityStyles(priority);
  const placementClass = inline ? 'inline-block' : 'flex-shrink-0';
  return (
    <span
      className={`${placementClass} px-2 py-0.5 rounded-full text-xs font-semibold uppercase ${styles}`}
    >
      {priority}
    </span>
  );
}

function priorityStyles(priority: Priority): string {
  if (priority === 'high') {
    return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300';
  }
  if (priority === 'medium') {
    return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300';
  }
  return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
}
