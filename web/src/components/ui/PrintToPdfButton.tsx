import { useLocation } from 'react-router-dom';

/**
 * Opens the current view in a new browser tab with `?print=1` appended.
 *
 * The print-mode layout (see `App.tsx`) detects this query param and:
 *  - hides the sidebar and most chrome,
 *  - automatically triggers `window.print()` so the user lands directly
 *    on the browser's "Save as PDF" / printer dialog.
 *
 * The user can either save the PDF, send to a printer, or close the
 * dialog and still see the print-formatted view in the new tab.
 */
export const PrintToPdfButton = () => {
  const location = useLocation();

  const handleClick = () => {
    const params = new URLSearchParams(location.search);
    params.set('print', '1');
    const target = `${location.pathname}?${params.toString()}${location.hash}`;
    // window.open with absolute URL keeps the auth/session cookies on the new tab.
    window.open(target, '_blank', 'noopener,noreferrer');
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-gray-500"
      title="Save view as PDF"
      aria-label="Save current view as PDF (opens in new tab)"
    >
      {/* Document outline with folded corner + "PDF" label inside — universally read as "save as PDF" */}
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9l-6-6z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M14 3v6h6"
        />
        <text
          x="12"
          y="17.5"
          textAnchor="middle"
          fontSize="5"
          fontWeight="700"
          fill="currentColor"
          stroke="none"
        >
          PDF
        </text>
      </svg>
    </button>
  );
};
