import type { CitationGap } from '../../types';

const PRIORITY_STYLES: Record<string, string> = {
  high: 'bg-red-100 text-red-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-gray-100 text-gray-800'
};

export function GapCard({ gap }: { readonly gap: CitationGap }) {
  return (
    <div className="bg-white p-4 rounded-lg shadow">
      <div className="flex justify-between items-start mb-2">
        <div className="flex-1 min-w-0">
          <a
            href={gap.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline text-sm font-medium truncate block"
          >
            {gap.title ?? gap.url}
          </a>
          <div className="text-xs text-gray-400 truncate">{gap.domain}</div>
        </div>
        <span className={`px-2 py-1 rounded text-xs ml-2 ${PRIORITY_STYLES[gap.priority] ?? PRIORITY_STYLES.low}`}>
          {gap.priority}
        </span>
      </div>

      <div className="flex gap-4 text-sm mb-2">
        <div>
          <span className="text-gray-500">Citations:</span>{' '}
          <span className="font-medium">{gap.citation_count}</span>
        </div>
        <div>
          <span className="text-gray-500">Providers:</span>{' '}
          <span className="font-medium">{gap.provider_count}</span>
        </div>
      </div>

      {gap.competitor_brands.length > 0 && (
        <div className="mt-2">
          <div className="text-xs text-gray-500 mb-1">Competitors mentioned:</div>
          <div className="flex flex-wrap gap-1">
            {gap.competitor_brands.map(brand => (
              <span key={brand} className="px-2 py-0.5 bg-red-50 text-red-700 rounded text-xs">
                {brand}
              </span>
            ))}
          </div>
        </div>
      )}

      {gap.keyword && (
        <div className="mt-2 text-xs text-gray-400">
          Keyword: {gap.keyword}
        </div>
      )}
    </div>
  );
}
