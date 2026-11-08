import {
  useCallback, useEffect, useRef, useState
} from 'react';
import { fetchBacklinksTable } from '../api/seoBacklinks';
import { seoErrorMessage } from '../api/seo';
import type {
  BacklinkRow, BacklinksTargetRequest
} from '../types/api/seoBacklinks';

/** One expanded referring domain's links: loading, loaded, or failed. */
export type DomainLinks =
  | { readonly status: 'loading' }
  | {
    readonly status: 'loaded';
    readonly rows: readonly BacklinkRow[];
  }
  | {
    readonly status: 'error';
    readonly message: string;
  };

export interface DomainExpansion {
  readonly expanded: ReadonlyMap<string, DomainLinks>;
  /** Expand (loading its links once, a paid request) or collapse one referring domain. */
  readonly toggle: (domain: string) => void;
}

const EXPANSION_PAGE_SIZE = 100;

/**
 * Lazy expansion of the one-per-domain view: the first expansion of a domain
 * asks for every link from it (`as_is`, strongest first, the same spam rule);
 * collapsing keeps the answer, so expanding again is free.
 */
export function useBacklinksDomainExpansion(target: BacklinksTargetRequest, includeSpam: boolean): DomainExpansion {
  const [expanded, setExpanded] = useState<ReadonlyMap<string, DomainLinks>>(new Map());
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const controllers = useRef(new Set<AbortController>());

  useEffect(() => {
    const active = controllers.current;
    return () => {
      for (const controller of active) controller.abort();
    };
  }, []);

  const settle = useCallback((domain: string, links: DomainLinks) => {
    setExpanded((current) => new Map(current).set(domain, links));
  }, []);

  const load = useCallback(async (domain: string) => {
    const controller = new AbortController();
    controllers.current.add(controller);
    settle(domain, { status: 'loading' });
    try {
      const page = await fetchBacklinksTable('backlinks', {
        ...target,
        page: 1,
        page_size: EXPANSION_PAGE_SIZE,
        sort_field: 'rank',
        sort_order: 'desc',
        filters: { domain_from: domain },
        include_spam: includeSpam,
        mode: 'as_is',
      }, { signal: controller.signal });
      settle(domain, {
        status: 'loaded',
        rows: page.rows,
      });
    } catch (failure) {
      if (!controller.signal.aborted) {
        settle(domain, {
          status: 'error',
          message: seoErrorMessage(failure),
        });
      }
    } finally {
      controllers.current.delete(controller);
    }
  }, [includeSpam, settle, target]);

  const toggle = useCallback((domain: string) => {
    const opening = !open.has(domain);
    setOpen((current) => {
      const next = new Set(current);
      if (opening) next.add(domain);
      else next.delete(domain);
      return next;
    });
    const known = expanded.get(domain);
    if (opening && (known === undefined || known.status === 'error')) void load(domain);
  }, [expanded, load, open]);

  const visible = new Map([...expanded].filter(([domain]) => open.has(domain)));
  return {
    expanded: visible,
    toggle,
  };
}
