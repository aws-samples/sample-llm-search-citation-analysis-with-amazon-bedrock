/**
 * "Use a tracked keyword": the Settings keywords of the header market as seed suggestions.
 * Picking one only fills the seed; the paid research still waits for Search.
 */
import { useMarketKeywords } from '../../../hooks/useSeoSettings';
import { SettingsHint } from '../../Seo/SettingsHint';
import {
  Skeleton, SkeletonRegion
} from '../../ui/Skeleton';

export const PICKER_LABEL = 'Use a tracked keyword';
export const NO_TRACKED_KEYWORD = 'The market has no tracked keyword yet.';

const SELECT_CLASS = 'w-full sm:w-56 p-2 border border-gray-200 rounded-lg text-sm text-gray-700 focus:ring-2 focus:ring-gray-900';

interface TrackedKeywordPickerProps {
  readonly onPick: (keyword: string) => void;
  readonly disabled?: boolean;
}

export function TrackedKeywordPicker({
  onPick, disabled = false
}: TrackedKeywordPickerProps) {
  const {
    data: keywords, loaded, error
  } = useMarketKeywords();

  if (!loaded) {
    return (
      <SkeletonRegion label="Loading tracked keywords" className="w-full sm:w-56">
        <Skeleton className="h-9 w-full rounded-lg" />
      </SkeletonRegion>
    );
  }
  // The picker is a convenience: a failed read leaves the free-text seed as it was.
  if (error !== null) return null;
  if (keywords.length === 0) return <SettingsHint section="keywords">{NO_TRACKED_KEYWORD}</SettingsHint>;

  return (
    <select
      aria-label={PICKER_LABEL}
      value=""
      disabled={disabled}
      onChange={(event) => { if (event.target.value !== '') onPick(event.target.value); }}
      className={SELECT_CLASS}
    >
      <option value="">{`${PICKER_LABEL}…`}</option>
      {keywords.map((keyword) => <option key={keyword} value={keyword}>{keyword}</option>)}
    </select>
  );
}
