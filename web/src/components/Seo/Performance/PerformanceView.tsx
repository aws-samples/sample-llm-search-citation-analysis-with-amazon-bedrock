/**
 * Page performance: Lighthouse scores and Core Web Vitals of the brand's own pages, and IndexNow
 * submissions of changed pages.
 *
 * A Lighthouse run is paid and starts only on a click; a batch asks for confirmation with its paid call count first.
 * Recent runs, the batch sample and the IndexNow setup are free reads made when the tab opens.
 */
import { useState } from 'react';
import { isSeoApiConfigured } from '../../../api/seo';
import {
  TabBar, TabPanel, type TabDefinition
} from '../../ui/TabBar';
import { PageHeaderCard } from '../../ui/PageHeaderCard';
import { NOT_SET_UP_TITLE } from '../../KeywordResearch/explorer/KeywordExplorer';
import { IndexNowTab } from './IndexNowTab';
import { LighthouseTab } from './LighthouseTab';

type PerformanceTab = 'lighthouse' | 'indexnow';

const TABS: readonly TabDefinition<PerformanceTab>[] = [
  {
    id: 'lighthouse',
    label: 'Lighthouse'
  },
  {
    id: 'indexnow',
    label: 'IndexNow'
  },
];

function PerformanceNotSetUp() {
  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6" aria-labelledby="performance-setup">
      <h3 id="performance-setup" className="text-base font-semibold text-gray-900">{NOT_SET_UP_TITLE}</h3>
      <p className="mt-2 text-sm text-gray-600">
        Page performance runs Lighthouse through DataForSEO and submits pages to IndexNow. Deploy the SEO stack
        (<code>CitationAnalysisSeoStack</code>) and rebuild the dashboard; then an Admin adds the DataForSEO login in
        Settings › AI Providers.
      </p>
    </section>
  );
}

const PANEL_ID = 'page-performance-panel';

function ConfiguredPerformance() {
  const [tab, setTab] = useState<PerformanceTab>('lighthouse');
  return (
    <div className="space-y-4">
      <PageHeaderCard title="Performance" relaxed={false}
        description="Lighthouse scores and Core Web Vitals of your own pages, and IndexNow submissions of the pages you changed." />
      <TabBar label="Page performance" tabs={TABS} activeId={tab} onChange={setTab} panelId={PANEL_ID} />
      <TabPanel id={PANEL_ID} activeId={tab}>
        {tab === 'lighthouse' ? <LighthouseTab /> : <IndexNowTab />}
      </TabPanel>
    </div>
  );
}

export function PerformanceView() {
  if (!isSeoApiConfigured()) return <PerformanceNotSetUp />;
  return <ConfiguredPerformance />;
}
