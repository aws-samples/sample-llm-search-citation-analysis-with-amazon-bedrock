/**
 * Support for the SEO router spec: stand-in pages whose views only print
 * their name (so the spec exercises the routing without loading the real
 * feature pages), and the router rendered at a path
 * with the current path printed beside it.
 */
import {
  lazy, type ReactElement
} from 'react';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MemoryRouter, useLocation
} from 'react-router-dom';
import type { SeoPage } from './seoPages';

function fakeSeoPage(slug: string, label: string, iconColor: string): SeoPage {
  return {
    slug,
    label,
    summary: `${label} summary`,
    iconPaths: ['M0 0h1'],
    iconColor,
    view: lazy(() => Promise.resolve({ default: () => <p>{label} page</p> })),
  };
}

export const FAKE_SEO_PAGES: readonly SeoPage[] = [
  fakeSeoPage('rank-tracking', 'Rank Tracking', 'text-emerald-500'),
  fakeSeoPage('backlinks', 'Backlinks', 'text-violet-500'),
];

function CurrentPath() {
  return <output aria-label="Current path">{useLocation().pathname}</output>;
}

/**
 * `router` (the SEO router, passed in so this module never imports the mocked
 * page list) opened at `path`; returns the user that drives it.
 */
export function renderRouterAt(router: ReactElement, path: string): ReturnType<typeof userEvent.setup> {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[path]}>
      {router}
      <CurrentPath />
    </MemoryRouter>,
  );
  return user;
}
