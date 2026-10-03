import {
  PAUSE_PATHS,
  PLAY_PATHS,
  PENCIL_PATHS,
  TRASH_PATHS,
  PLUS_PATHS,
  CLOSE_PATHS,
  CHEVRON_DOWN_PATHS,
  SEARCH_PATHS,
  LINK_PATHS,
  GLOBE_PATHS,
  KEY_PATHS,
  WARNING_PATHS,
  CHECK_PATHS,
  ARROW_RIGHT_PATHS,
  EYE_PATHS,
  COG_PATHS,
  REFRESH_PATHS,
  CLOCK_PATHS,
  COLLECTION_PATHS,
} from './iconPaths';
import { StrokeIcon } from './StrokeIcon';

/**
 * Centralized icon library.
 *
 * All icons follow the same Heroicons-style outline convention used across
 * the app: 24×24 viewBox, stroke-based, `currentColor`, configurable size
 * and class via props so they inherit the surrounding text color and dark
 * mode treatment automatically.
 *
 * See `docs/design-system.md` for icon usage guidelines.
 */

interface IconProps {
  /** Tailwind size classes (default: `w-5 h-5`). */
  readonly className?: string;
  /** Title for accessible labelling. When provided, icon becomes labelled. */
  readonly title?: string;
}

const labelling = (title?: string) => ({
  'aria-hidden': title === undefined,
  role: title === undefined ? undefined : 'img',
});

interface OutlineIconProps extends IconProps {
  /** One `d` attribute per `<path>`; every icon is drawn from these alone. */
  readonly paths: readonly string[];
}

/**
 * The wrapper every named icon renders through. Path data is the only thing
 * that varies between icons, so it is the only thing each icon supplies.
 */
const OutlineIcon = ({
  className, title, paths
}: OutlineIconProps) => (
  <StrokeIcon className={className ?? 'w-5 h-5'} paths={paths} {...labelling(title)}>
    {title && <title>{title}</title>}
  </StrokeIcon>
);

export const PauseIcon = (props: IconProps) => <OutlineIcon {...props} paths={PAUSE_PATHS} />;
export const PlayIcon = (props: IconProps) => <OutlineIcon {...props} paths={PLAY_PATHS} />;
export const PencilIcon = (props: IconProps) => <OutlineIcon {...props} paths={PENCIL_PATHS} />;
export const TrashIcon = (props: IconProps) => <OutlineIcon {...props} paths={TRASH_PATHS} />;
export const PlusIcon = (props: IconProps) => <OutlineIcon {...props} paths={PLUS_PATHS} />;
export const CloseIcon = (props: IconProps) => <OutlineIcon {...props} paths={CLOSE_PATHS} />;
export const ChevronDownIcon = (props: IconProps) => <OutlineIcon {...props} paths={CHEVRON_DOWN_PATHS} />;
export const SearchIcon = (props: IconProps) => <OutlineIcon {...props} paths={SEARCH_PATHS} />;
export const LinkIcon = (props: IconProps) => <OutlineIcon {...props} paths={LINK_PATHS} />;
export const GlobeIcon = (props: IconProps) => <OutlineIcon {...props} paths={GLOBE_PATHS} />;
export const KeyIcon = (props: IconProps) => <OutlineIcon {...props} paths={KEY_PATHS} />;
export const WarningIcon = (props: IconProps) => <OutlineIcon {...props} paths={WARNING_PATHS} />;
export const CheckIcon = (props: IconProps) => <OutlineIcon {...props} paths={CHECK_PATHS} />;
export const ArrowRightIcon = (props: IconProps) => <OutlineIcon {...props} paths={ARROW_RIGHT_PATHS} />;
export const EyeIcon = (props: IconProps) => <OutlineIcon {...props} paths={EYE_PATHS} />;
export const CogIcon = (props: IconProps) => <OutlineIcon {...props} paths={COG_PATHS} />;
export const RefreshIcon = (props: IconProps) => <OutlineIcon {...props} paths={REFRESH_PATHS} />;
export const ClockIcon = (props: IconProps) => <OutlineIcon {...props} paths={CLOCK_PATHS} />;
export const CollectionIcon = (props: IconProps) => <OutlineIcon {...props} paths={COLLECTION_PATHS} />;
