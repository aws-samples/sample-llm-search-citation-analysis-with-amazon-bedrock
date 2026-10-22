/** `<filePrefix>-<YYYY-MM-DD>.xlsx`, dated in UTC. */
export function datedExcelFileName(filePrefix: string, date: Date): string {
  return `${filePrefix}-${date.toISOString().slice(0, 10)}.xlsx`;
}
