import { Suspense } from 'react';
import {
  Navigate, Route, Routes, useLocation
} from 'react-router-dom';
import { ErrorBoundary } from '../ErrorBoundary';
import { SkeletonPage } from '../ui/Skeleton';
import { SeoHome } from './SeoHome';
import {
  SEO_BASE_PATH, SEO_PAGES, seoPagePath
} from './seoPages';

/**
 * Sub-router for `/seo/*`: the SEO home at `/seo`, one lazily loaded page per entry of `SEO_PAGES` at
 * `/seo/<slug>` (the sidebar's SEO group links to each, so deep links and the back button work). An unknown
 * sub-path lands on the SEO home so an old link never shows a blank page.
 */
export function SeoRouter() {
  const { pathname } = useLocation();
  return (
    <div className="min-w-0">
      {/* Keyed on the page so a crash on one page clears when another is opened. */}
      <ErrorBoundary key={pathname}>
        <Suspense fallback={<SkeletonPage label="Loading SEO page" />}>
          <Routes>
            <Route path={SEO_BASE_PATH} element={<SeoHome />} />
            {SEO_PAGES.map((page) => (
              <Route key={page.slug} path={seoPagePath(page)} element={<page.view />} />
            ))}
            <Route path="*" element={<Navigate to={SEO_BASE_PATH} replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
