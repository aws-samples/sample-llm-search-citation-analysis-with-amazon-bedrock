import type { CompetitorRollup } from '../../../../api/reports';

export function buildRollup(rows: CompetitorRollup['outranked_keywords']): CompetitorRollup {
  return {
    competitor: 'Adidas',
    outranked_keywords: rows,
    exclusive_sources: [],
    outreach_targets: [],
  };
}
