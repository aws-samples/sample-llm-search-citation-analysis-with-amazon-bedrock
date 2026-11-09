/** One built-in report as the Reports page lists it. */
export interface ReportEntry {
  /** The report's name, as its page heading says it. */
  readonly title: string;
  /** The question the report answers, in the reader's words. */
  readonly question: string;
  readonly audience: string;
  readonly path: string;
}

/** The reports that answer one question, under that question. */
export interface ReportGroup {
  readonly id: string;
  readonly question: string;
  readonly reports: readonly ReportEntry[];
}

/**
 * The built-in reports, grouped by the question a marketing team brings to
 * the page: the state of visibility, the competition, where the answers come
 * from, and what to do next.
 */
export const REPORT_GROUPS: readonly ReportGroup[] = [
  {
    id: 'visible',
    question: 'How visible are we?',
    reports: [
      {
        title: 'Executive Summary',
        question: 'Where do we stand overall, what changed, and what are the next three actions?',
        audience: 'CMO, VP Marketing',
        path: '/reports/executive-summary',
      },
      {
        title: 'Brand Visibility',
        question: 'How often do AI answers name us, and is every KPI rising or falling?',
        audience: 'Marketing lead',
        path: '/reports/visibility',
      },
    ],
  },
  {
    id: 'compare',
    question: 'How do we compare?',
    reports: [
      {
        title: 'Competitor Benchmark',
        question: 'How does our share of voice compare with every brand the answers name?',
        audience: 'Brand manager, competitive intelligence',
        path: '/reports/benchmark',
      },
      {
        title: 'Competitor Gap',
        question: 'Where does one competitor beat us, and which sources should we reach?',
        audience: 'Content / PR strategist',
        path: '/reports/competitor',
      },
      {
        title: 'Sentiment',
        question: 'How do AI answers word our brand, and other brands?',
        audience: 'Brand / communications lead',
        path: '/reports/sentiment',
      },
    ],
  },
  {
    id: 'sources',
    question: 'Where do the answers come from?',
    reports: [
      {
        title: 'AI Engines',
        question: 'Which AI engines name us, and how do they differ?',
        audience: 'AI search specialist',
        path: '/reports/engines',
      },
      {
        title: 'Sources',
        question: 'Which websites do the answers cite, and are ours among them?',
        audience: 'SEO and digital PR',
        path: '/reports/sources',
      },
      {
        title: 'SEO vs GEO',
        question: 'Where do our Google rankings and AI mentions disagree?',
        audience: 'SEO and AI search lead',
        path: '/reports/seo-geo',
      },
    ],
  },
  {
    id: 'act',
    question: 'What should we do next?',
    reports: [
      {
        title: 'Content Action Plan',
        question: 'Which content should we create to close our citation gaps?',
        audience: 'Content strategist',
        path: '/reports/content-action-plan',
      },
      {
        title: 'Keyword Deep Dive',
        question: 'Why does one keyword rank the way it does, and how do we improve it?',
        audience: 'SEO / AI search lead',
        path: '/reports/keyword',
      },
    ],
  },
];
