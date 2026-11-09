import { StrokeIcon } from '../ui/StrokeIcon';
import { DOWNLOAD_PATHS } from '../ui/iconPaths';
interface DownloadButtonProps {readonly onClick: () => void;}

/** Dark "Download" action shared by the file and image viewer headers. */
export const DownloadButton = ({ onClick }: DownloadButtonProps) => (
  <button
    type="button"
    onClick={onClick}
    className="px-3 py-1.5 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors flex items-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2"
  >
    <StrokeIcon className="w-4 h-4" paths={DOWNLOAD_PATHS} />
    <span className="sr-only sm:not-sr-only">Download</span>
  </button>
);
