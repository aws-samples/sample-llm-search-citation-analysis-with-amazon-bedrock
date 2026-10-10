import type { KpiDefinition } from '../../../constants/kpiDefinitions';
import { Disclosure } from '../../ui/Disclosure';
import { KpiDefinitionList } from '../../ui/KpiDefinitionList';
import { ReportSection } from './ReportSection';

interface Props {
  /** The definitions of every figure the report shows, in the order it shows them. */
  readonly definitions: readonly KpiDefinition[];
}

/**
 * How every KPI in the report is measured — the tooltip text, written out
 * so it survives printing and sharing. Every report ends with one. It is
 * collapsed on screen (the tooltips carry the same text) and always open in
 * print.
 */
export function KpiDefinitionsSection({ definitions }: Props) {
  return (
    <ReportSection>
      <Disclosure
        title="How these KPIs are measured"
        headingLevel={2}
        headingClassName="text-base font-semibold text-gray-900 dark:text-white"
      >
        <KpiDefinitionList definitions={definitions} />
      </Disclosure>
    </ReportSection>
  );
}
