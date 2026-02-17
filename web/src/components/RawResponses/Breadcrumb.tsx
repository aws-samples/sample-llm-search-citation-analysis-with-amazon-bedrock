interface BreadcrumbProps {
  path: string[];
  onNavigate: (index: number) => void;
  rootLabel?: string;
}

export const Breadcrumb = ({
  path, onNavigate, rootLabel = 'raw-responses' 
}: BreadcrumbProps) => {
  return (
    <nav className="flex items-center space-x-1 text-sm">
      <button
        onClick={() => onNavigate(-1)}
        className={`flex items-center gap-1.5 px-2 py-1 rounded hover:bg-gray-200 transition-colors ${
          path.length === 0 ? 'text-gray-900 font-medium' : 'text-gray-500'
        }`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
          />
        </svg>
        {rootLabel}
      </button>

      {path.map((segment, index) => (
        <div key={segment} className="flex items-center">
          <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
          </svg>
          <button
            onClick={() => onNavigate(index)}
            className={`px-2 py-1 rounded hover:bg-gray-200 transition-colors ${
              index === path.length - 1 ? 'text-gray-900 font-medium' : 'text-gray-500'
            }`}
          >
            {segment}
          </button>
        </div>
      ))}
    </nav>
  );
};
