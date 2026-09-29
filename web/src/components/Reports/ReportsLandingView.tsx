import { Link } from 'react-router-dom';

interface ReportEntry {
  readonly title: string;
  readonly description: string;
  readonly audience: string;
  readonly path: string | null;
  readonly status: 'available' | 'coming-soon';
}

/**
 * The reports, ordered to match the marketing decision each one supports
 * (top-down strategic to bottom-up operational). A report marked
 * `coming-soon` is listed but links nowhere; the placeholder makes the
 * planned scope visible to users without surprising them on a 404.
 */
const REPORT_CATALOG: readonly ReportEntry[] = [
  {
    title: 'Executive Summary',
    description:
      'One-page rollup of overall visibility, the trend over time, top wins, top gaps, and the next three actions to take. The report a marketing lead would print before a quarterly business review.',
    audience: 'CMO, VP Marketing',
    path: '/reports/executive-summary',
    status: 'available',
  },
  {
    title: 'Brand Visibility Report',
    description:
      'Mention rate, share of voice, visibility score, citation rate and every other KPI with its change and trend, the brand leaderboard and the KPIs per day, scoped to a keyword, a keyword group or the full keyword set. Highlights regressions in red.',
    audience: 'Marketing lead',
    path: '/reports/visibility',
    status: 'available',
  },
  {
    title: 'Competitor Benchmark',
    description:
      'Your share of voice and rank against every brand the AI answers name: the share-of-voice donut, the leading brands over time by share of voice, mention rate or visibility score, and the full leaderboard with every KPI per brand.',
    audience: 'Brand manager, competitive intelligence',
    path: '/reports/benchmark',
    status: 'available',
  },
  {
    title: 'AI Engines',
    description:
      'How each AI engine treats your brand: which engines name you, mention rate, visibility score and citation rate per engine side by side, every KPI per engine, and how each engine words its mentions.',
    audience: 'AI search specialist',
    path: '/reports/engines',
    status: 'available',
  },
  {
    title: 'Sources',
    description:
      'Which websites the AI answers cite: your citations, citation rate and citation share, the most cited domains with your own highlighted, and every cited domain with its engines and keywords.',
    audience: 'SEO and digital PR',
    path: '/reports/sources',
    status: 'available',
  },
  {
    title: 'Sentiment',
    description:
      'How the AI answers word your brand: net sentiment with its change and split, the net sentiment over time, the split per AI engine, and the net sentiment of every brand named.',
    audience: 'Brand / communications lead',
    path: '/reports/sentiment',
    status: 'available',
  },
  {
    title: 'Competitor Gap Report',
    description:
      'For each tracked competitor: keywords where they outrank you, citation sources unique to them, and a prioritized outreach list ranked by potential visibility lift.',
    audience: 'Content / PR strategist',
    path: '/reports/competitor',
    status: 'available',
  },
  {
    title: 'Content Action Plan',
    description:
      'Prioritized citation gaps paired with AI-generated content briefs from Content Studio. Closes the loop from "we have a gap" to "here is the asset to fill it".',
    audience: 'Content strategist',
    path: '/reports/content-action-plan',
    status: 'available',
  },
  {
    title: 'Keyword Deep Dive',
    description:
      'Single-keyword drill-down: every KPI with its change, KPI history, persona impact, provider differences, top sources, sentiment examples, recommended actions, and an LLM-generated narrative explaining the current ranking.',
    audience: 'SEO / AI search lead',
    path: '/reports/keyword',
    status: 'available',
  },
];

export function ReportsLandingView() {
  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 sm:p-6">
        <h2 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white">
          Reports
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 leading-relaxed max-w-3xl">
          Print-ready, narrative views of the data already on your dashboards.
          Each report is scoped to one decision and one audience. Use the Save
          as PDF button on any report to export it for sharing.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {REPORT_CATALOG.map((report) => (
          <ReportCard key={report.title} report={report} />
        ))}
      </div>
    </div>
  );
}

function ReportCard({ report }: { readonly report: ReportEntry }) {
  const isAvailable = report.status === 'available' && report.path;
  const cardClasses = [
    'block',
    'p-5',
    'bg-white',
    'dark:bg-gray-800',
    'rounded-lg',
    'border',
    isAvailable
      ? 'border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500 transition-colors'
      : 'border-dashed border-gray-200 dark:border-gray-700 opacity-75',
  ].join(' ');

  const body = (
    <>
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">
          {report.title}
        </h3>
        {!isAvailable && (
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">
            Coming soon
          </span>
        )}
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
        {report.description}
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
        For: {report.audience}
      </p>
    </>
  );

  if (isAvailable && report.path) {
    return (
      <Link to={report.path} className={cardClasses}>
        {body}
      </Link>
    );
  }

  return <div className={cardClasses}>{body}</div>;
}
