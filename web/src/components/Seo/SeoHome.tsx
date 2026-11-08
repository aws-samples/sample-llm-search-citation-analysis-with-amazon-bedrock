import { Link } from 'react-router-dom';
import { isSeoApiConfigured } from '../../api/seo';
import { DATAFORSEO_PROVIDER_ID } from '../../constants/providers';
import { useProviderConfig } from '../../hooks/useProviderConfig';
import { settingsPath } from '../Settings/settingsSections';
import { PageHeaderCard } from '../ui/PageHeaderCard';
import {
  SEO_PAGES, seoPagePath
} from './seoPages';

export const SEO_SETUP_TITLE = 'Set up SEO data';

interface SeoLink {
  readonly key: string;
  readonly to: string;
  readonly label: string;
  readonly summary: string;
}

/** Pages that live elsewhere in the dashboard but read the same SEO data. */
const RELATED_LINKS: readonly SeoLink[] = [
  {
    key: 'keyword-explorer',
    to: '/keyword-research',
    label: 'Keyword Explorer',
    summary: 'Keyword ideas with volume, difficulty, CPC and intent (Keyword Research › Keyword Explorer).',
  },
  {
    key: 'seo-geo',
    to: '/reports/seo-geo',
    label: 'SEO vs GEO report',
    summary: 'Organic Google positions against AI answer mentions, keyword by keyword.',
  },
];

const PAGE_LINKS: readonly SeoLink[] = SEO_PAGES.map((page) => ({
  key: page.slug,
  to: seoPagePath(page),
  label: page.label,
  summary: page.summary,
}));

function SetupPanel({ deployed }: { readonly deployed: boolean }) {
  return (
    <section aria-labelledby="seo-setup-title" className="rounded-lg border border-amber-200 bg-amber-50 p-4 sm:p-6 space-y-2">
      <h3 id="seo-setup-title" className="text-base font-semibold text-amber-900">{SEO_SETUP_TITLE}</h3>
      {deployed ? (
        <p className="text-sm text-amber-800">
          No DataForSEO login is stored yet. An Admin adds it in{' '}
          <Link to={settingsPath('providers')} className="font-medium underline">Settings › AI Providers</Link>.
        </p>
      ) : (
        <p className="text-sm text-amber-800">
          The SEO stack is not deployed. Deploy <code>CitationAnalysisSeoStack</code>, rebuild the dashboard,
          then add the DataForSEO login in Settings › AI Providers.
        </p>
      )}
    </section>
  );
}

/**
 * The setup panel once the providers are known to lack a DataForSEO login. A
 * free read of the main API; while it loads, or when it failed, nothing shows
 * (the SEO pages report their own errors).
 */
function DataForSeoKeyCheck() {
  const {
    providers, loading, error
  } = useProviderConfig();
  const dataForSeo = providers.find((provider) => provider.id === DATAFORSEO_PROVIDER_ID);
  if (loading || error !== null || dataForSeo === undefined || dataForSeo.configured) return null;
  return <SetupPanel deployed />;
}

function SeoLinkCard({ link }: { readonly link: SeoLink }) {
  return (
    <li>
      <Link
        to={link.to}
        className="block h-full rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/50"
      >
        <span className="block text-sm font-semibold text-gray-900 dark:text-white">{link.label}</span>
        <span className="mt-1 block text-sm text-gray-600 dark:text-gray-300">{link.summary}</span>
      </Link>
    </li>
  );
}

function SeoLinkGrid({
  title, links
}: {
  readonly title: string;
  readonly links: readonly SeoLink[];
}) {
  return (
    <section aria-label={title} className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">{title}</h3>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {links.map((link) => <SeoLinkCard key={link.key} link={link} />)}
      </ul>
    </section>
  );
}

/** `/seo`: what each SEO page does, and the setup step still missing, if any. */
export function SeoHome() {
  const deployed = isSeoApiConfigured();
  return (
    <div className="space-y-6">
      <PageHeaderCard
        title="SEO"
        description="Google organic data from DataForSEO next to your AI visibility. Paid DataForSEO lookups run only when you ask for them; batch and recurring work asks for confirmation first."
      />
      {deployed ? <DataForSeoKeyCheck /> : <SetupPanel deployed={false} />}
      <SeoLinkGrid title="SEO pages" links={PAGE_LINKS} />
      <SeoLinkGrid title="Elsewhere in the dashboard" links={RELATED_LINKS} />
    </div>
  );
}
