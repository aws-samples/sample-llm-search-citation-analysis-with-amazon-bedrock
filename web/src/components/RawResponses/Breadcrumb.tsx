import { StrokeIcon } from '../ui/StrokeIcon';
import { CHEVRON_RIGHT_PATHS } from '../ui/iconPaths';
const SEGMENT_CLASS = 'px-2 py-1 rounded hover:bg-gray-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500';

interface BreadcrumbProps {
  path: string[];
  onNavigate: (index: number) => void;
  rootLabel?: string;
}

export const Breadcrumb = ({
  path, onNavigate, rootLabel = 'raw-responses' 
}: BreadcrumbProps) => {
  const current = path.length - 1;
  return (
    <nav aria-label="Folder path" className="flex min-w-0 flex-wrap items-center gap-y-1 space-x-1 text-sm">
      <button
        type="button"
        onClick={() => onNavigate(-1)}
        aria-current={path.length === 0 ? 'page' : undefined}
        className={`${SEGMENT_CLASS} flex items-center gap-1.5 ${
          path.length === 0 ? 'text-gray-900 font-medium' : 'text-gray-500'
        }`}
      >
        <StrokeIcon className="w-4 h-4" paths={['M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4']} />
        {rootLabel}
      </button>

      {path.map((segment, index) => (
        // A path can repeat a folder name, so the path up to the segment keys it.
        <div key={path.slice(0, index + 1).join('/')} className="flex min-w-0 items-center">
          <StrokeIcon className="w-4 h-4 shrink-0 text-gray-500" paths={CHEVRON_RIGHT_PATHS} />
          <button
            type="button"
            onClick={() => onNavigate(index)}
            aria-current={index === current ? 'page' : undefined}
            className={`${SEGMENT_CLASS} break-all text-left ${
              index === current ? 'text-gray-900 font-medium' : 'text-gray-500'
            }`}
          >
            {segment}
          </button>
        </div>
      ))}
    </nav>
  );
};
