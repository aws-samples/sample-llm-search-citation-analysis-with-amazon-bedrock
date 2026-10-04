import { Spinner } from '../ui/Spinner';
import { StrokeIcon } from '../ui/StrokeIcon';
import { BOLT_PATHS } from '../ui/iconPaths';

/** Content of an "Expand Brand" button: a spinner while the expansion runs. */
export const ExpandBrandLabel = ({ expanding }: { readonly expanding: boolean }) => (
  expanding ? <><Spinner size="sm" />Expanding...</> : (
    <><StrokeIcon className="w-3 h-3" paths={BOLT_PATHS} strokeWidth={2} />Expand Brand</>
  )
);
