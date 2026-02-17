import type { Search } from '../../types';

export const providerColors: Record<string, {
  border: string;
  bg: string 
}> = {
  claude: {
    border: 'rgb(168, 85, 247)',
    bg: 'rgba(168, 85, 247, 0.5)' 
  },
  gemini: {
    border: 'rgb(59, 130, 246)',
    bg: 'rgba(59, 130, 246, 0.5)' 
  },
  openai: {
    border: 'rgb(16, 185, 129)',
    bg: 'rgba(16, 185, 129, 0.5)' 
  },
  perplexity: {
    border: 'rgb(249, 115, 22)',
    bg: 'rgba(249, 115, 22, 0.5)' 
  },
};

export const defaultProviderColor = {
  border: 'rgb(107, 114, 128)',
  bg: 'rgba(107, 114, 128, 0.1)',
};

export const providers = ['claude', 'gemini', 'openai', 'perplexity'];

export interface KeywordStats {
  totalRuns: number;
  totalCitations: number;
  avgCitationsPerRun: number;
  lastRun: string;
  searches: Search[];
}

export const groupSearchesByTime = (searches: Search[]): Record<string, Search[]> => {
  const batches: Record<string, Search[]> = {};
  for (const search of searches) {
    const timeKey = new Date(search.timestamp).toLocaleTimeString();
    if (!batches[timeKey]) {
      batches[timeKey] = [];
    }
    batches[timeKey].push(search);
  }
  return batches;
};

export const buildChartData = (searches: Search[], runBatches: Record<string, Search[]>) => {
  const batchKeys = Object.keys(runBatches).reverse();
  const batchLabels = batchKeys.map((_, idx) => `Batch ${idx + 1}`);

  const lineDatasets = providers.map((provider) => {
    const data = batchKeys.map((batchKey) => {
      const batch = runBatches[batchKey];
      const providerSearch = batch.find((s) => s.provider.toLowerCase() === provider);
      return providerSearch?.citations?.length ?? 0;
    });

    const colors = providerColors[provider] ?? defaultProviderColor;
    return {
      label: provider.charAt(0).toUpperCase() + provider.slice(1),
      data,
      borderColor: colors.border,
      backgroundColor: colors.bg,
      pointBackgroundColor: colors.border,
      pointBorderColor: colors.border,
      pointRadius: 6,
      pointHoverRadius: 8,
      tension: 0.3,
    };
  });

  const citationByProvider = buildCitationByProvider(searches);
  const citationFrequency = buildCitationFrequency(citationByProvider);

  const barChartLabels = citationFrequency.map((c) =>
    c.url.length > 40 ? c.url.slice(0, 40) + '...' : c.url
  );
  const barDatasets = providers.map((provider) => {
    const colors = providerColors[provider] ?? defaultProviderColor;
    return {
      label: provider.charAt(0).toUpperCase() + provider.slice(1),
      data: citationFrequency.map((c) => c.providerCounts[provider] ?? 0),
      backgroundColor: colors.bg,
      borderColor: colors.border,
      borderWidth: 1,
    };
  });

  return {
    lineChartData: {
      labels: batchLabels,
      datasets: lineDatasets 
    },
    barChartData: {
      labels: barChartLabels,
      datasets: barDatasets 
    },
  };
};

function buildCitationByProvider(searches: Search[]): Record<string, Record<string, number>> {
  const citationByProvider: Record<string, Record<string, number>> = {};
  for (const search of searches) {
    const provider = search.provider.toLowerCase();
    for (const url of search.citations ?? []) {
      if (!citationByProvider[url]) {
        citationByProvider[url] = {};
      }
      citationByProvider[url][provider] = (citationByProvider[url][provider] ?? 0) + 1;
    }
  }
  return citationByProvider;
}

function buildCitationFrequency(citationByProvider: Record<string, Record<string, number>>) {
  return Object.entries(citationByProvider)
    .map(([url, providerCounts]) => ({
      url,
      totalCount: Object.values(providerCounts).reduce((a, b) => a + b, 0),
      providerCounts,
    }))
    .sort((a, b) => b.totalCount - a.totalCount)
    .slice(0, 10);
}

export const lineChartOptions = {
  responsive: true,
  plugins: {
    legend: {
      display: true,
      position: 'bottom' as const 
    },
    tooltip: {
      callbacks: {
        label: (context: {
          dataset: { label?: string };
          parsed: { y: number | null } 
        }) =>
          `${context.dataset.label ?? ''}: ${context.parsed.y ?? 0} citations`,
      },
    },
  },
  scales: { y: { beginAtZero: true } },
};

export const barChartOptions = {
  responsive: true,
  plugins: {
    legend: {
      display: true,
      position: 'bottom' as const 
    },
    tooltip: {
      callbacks: {
        label: (context: {
          dataset: { label?: string };
          parsed: { y: number | null } 
        }) =>
          `${context.dataset.label ?? ''}: ${context.parsed.y ?? 0}`,
        footer: (tooltipItems: Array<{ parsed: { y: number | null } }>) => {
          const total = tooltipItems.reduce((sum, item) => sum + (item.parsed.y ?? 0), 0);
          return `Total: ${total}`;
        },
      },
    },
  },
  scales: {
    x: { stacked: true },
    y: {
      stacked: true,
      beginAtZero: true,
      ticks: { stepSize: 1 } 
    },
  },
};

interface DetailHeaderProps {
  keyword: string;
  stats: KeywordStats;
  onClose: () => void;
}

export const DetailHeader = ({
  keyword, stats, onClose 
}: DetailHeaderProps) => (
  <div className="sticky top-0 bg-gray-50 border-b border-gray-200 p-4 sm:p-6 flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 rounded-t-lg">
    <div className="flex-1 min-w-0">
      <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2 truncate">{keyword}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4 text-sm">
        <StatItem label="Total Runs" value={stats.totalRuns} />
        <StatItem label="Citations" value={stats.totalCitations} />
        <StatItem label="Avg/Run" value={stats.avgCitationsPerRun.toFixed(1)} />
        <StatItem label="Last Run" value={new Date(stats.lastRun).toLocaleDateString()} />
      </div>
    </div>
    <button
      onClick={onClose}
      className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm shrink-0"
    >
      ✕ Close
    </button>
  </div>
);

const StatItem = ({
  label, value 
}: {
  label: string;
  value: string | number 
}) => (
  <div>
    <span className="text-gray-500">{label}:</span>
    <span className="ml-1 sm:ml-2 font-semibold text-gray-900">{value}</span>
  </div>
);

interface SearchItemProps {
  search: Search;
  globalIdx: number;
  isExpanded: boolean;
  onToggle: () => void;
  expandedResponse: number | null;
  setExpandedResponse: (value: number | null) => void;
  onNavigateToRawResponses?: (path: string) => void;
  buildRawResponsesPath: (search: Search) => string;
}

export const SearchItem = ({
  search,
  globalIdx,
  isExpanded,
  onToggle,
  expandedResponse,
  setExpandedResponse,
  onNavigateToRawResponses,
  buildRawResponsesPath,
}: SearchItemProps) => {
  const provider = search.provider.toLowerCase();
  const colors = providerColors[provider] ?? defaultProviderColor;

  return (
    <div className="border rounded-lg" style={{
      borderColor: colors.border,
      borderWidth: '2px' 
    }}>
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50"
        onClick={onToggle}
      >
        <div className="flex items-center gap-4 flex-1">
          <span
            className="px-2 py-1 rounded text-xs font-medium text-white"
            style={{ backgroundColor: colors.border }}
          >
            {search.provider}
          </span>
          <span className="text-sm text-gray-600">
            {new Date(search.timestamp).toLocaleString()}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span
            className="px-3 py-1 rounded-full text-sm font-medium"
            style={{
              backgroundColor: colors.bg,
              color: colors.border,
              border: `1px solid ${colors.border}`,
            }}
          >
            {search.citations?.length ?? 0} citations
          </span>
          <span className="text-gray-400">{isExpanded ? '▼' : '▶'}</span>
        </div>
      </div>

      {isExpanded && (
        <ExpandedSearchContent
          search={search}
          globalIdx={globalIdx}
          expandedResponse={expandedResponse}
          setExpandedResponse={setExpandedResponse}
          onNavigateToRawResponses={onNavigateToRawResponses}
          buildRawResponsesPath={buildRawResponsesPath}
        />
      )}
    </div>
  );
};

interface ExpandedSearchContentProps {
  search: Search;
  globalIdx: number;
  expandedResponse: number | null;
  setExpandedResponse: (value: number | null) => void;
  onNavigateToRawResponses?: (path: string) => void;
  buildRawResponsesPath: (search: Search) => string;
}

const ExpandedSearchContent = ({
  search,
  globalIdx,
  expandedResponse,
  setExpandedResponse,
  onNavigateToRawResponses,
  buildRawResponsesPath,
}: ExpandedSearchContentProps) => (
  <div className="border-t border-gray-200 p-4 bg-white space-y-4">
    {search.response && (
      <ResponseSection
        response={search.response}
        globalIdx={globalIdx}
        expandedResponse={expandedResponse}
        setExpandedResponse={setExpandedResponse}
      />
    )}

    {search.citations && search.citations.length > 0 && (
      <CitationsSection citations={search.citations} />
    )}

    {onNavigateToRawResponses && (
      <RawResponseLink
        search={search}
        onNavigateToRawResponses={onNavigateToRawResponses}
        buildRawResponsesPath={buildRawResponsesPath}
      />
    )}
  </div>
);

interface ResponseSectionProps {
  response: string;
  globalIdx: number;
  expandedResponse: number | null;
  setExpandedResponse: (value: number | null) => void;
}

const ResponseSection = ({
  response,
  globalIdx,
  expandedResponse,
  setExpandedResponse,
}: ResponseSectionProps) => (
  <div>
    <div className="text-xs font-medium text-gray-500 mb-2">AI Response</div>
    <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700">
      {expandedResponse === globalIdx ? (
        <div className="whitespace-pre-wrap">{response}</div>
      ) : (
        <div className="line-clamp-2">{response}</div>
      )}
      {response.length > 200 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpandedResponse(expandedResponse === globalIdx ? null : globalIdx);
          }}
          className="mt-2 text-xs text-gray-500 hover:text-gray-700 font-medium"
        >
          {expandedResponse === globalIdx ? '▲ Show less' : '▼ Show full response'}
        </button>
      )}
    </div>
  </div>
);

const CitationsSection = ({ citations }: { citations: string[] }) => (
  <div>
    <div className="text-xs font-medium text-gray-500 mb-2">Citations</div>
    <div className="space-y-1">
      {citations.map((citation) => (
        <div key={citation} className="flex items-start gap-2 text-sm">
          <span className="text-gray-400">•</span>
          <a
            href={citation}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline break-all flex-1"
          >
            {citation}
          </a>
        </div>
      ))}
    </div>
  </div>
);

interface RawResponseLinkProps {
  search: Search;
  onNavigateToRawResponses: (path: string) => void;
  buildRawResponsesPath: (search: Search) => string;
}

const RawResponseLink = ({
  search,
  onNavigateToRawResponses,
  buildRawResponsesPath,
}: RawResponseLinkProps) => (
  <div className="pt-2 border-t border-gray-100">
    <button
      onClick={(e) => {
        e.stopPropagation();
        onNavigateToRawResponses(buildRawResponsesPath(search));
      }}
      className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
        />
      </svg>
      View Raw Response
    </button>
  </div>
);
