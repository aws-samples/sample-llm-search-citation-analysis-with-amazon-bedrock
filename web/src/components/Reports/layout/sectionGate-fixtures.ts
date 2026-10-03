import type { SectionFetchState } from './sectionGate';

interface PlaceholderCase {
  readonly name: string;
  readonly state: SectionFetchState;
  readonly text: RegExp | string;
}

/**
 * A report section's fetch still running (showing `loadingText`), then failed
 * with `errorText` (shown as is). Spread `state` over the section's empty data.
 */
export function sectionPlaceholderCases(loadingText: RegExp | string, errorText = 'boom'): PlaceholderCase[] {
  return [
    {
      name: 'loading placeholder when loading is true',
      state: {
        loading: true,
        error: null,
      },
      text: loadingText,
    },
    {
      name: 'error message when error is set',
      state: {
        loading: false,
        error: errorText,
      },
      text: errorText,
    },
  ];
}
