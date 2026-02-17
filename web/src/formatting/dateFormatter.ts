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
