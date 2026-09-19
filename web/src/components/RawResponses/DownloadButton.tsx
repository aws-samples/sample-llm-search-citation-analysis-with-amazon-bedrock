interface DownloadButtonProps {readonly onClick: () => void;}

/** Dark "Download" action shared by the file and image viewer headers. */
export const DownloadButton = ({ onClick }: DownloadButtonProps) => (
  <button
    onClick={onClick}
    className="px-3 py-1.5 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors flex items-center gap-1"
  >
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
      />
    </svg>
    <span className="sr-only sm:not-sr-only">Download</span>
  </button>
);
