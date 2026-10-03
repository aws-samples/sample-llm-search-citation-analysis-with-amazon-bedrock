import type { ReportBlock } from '../../../api/customReports';
import { ReportSectionPlaceholder } from '../layout';
import {
  categoryLabel, dataBlockDefinition, scopeHint, supportsScope
} from './blockCatalog';
import { ContentBlockView } from './content/ContentBlockView';
import { isContentBlock } from './content/contentBlocks';
import type { ReportSources } from './reportSources';

interface Props {
  readonly block: ReportBlock;
  readonly sources: ReportSources;
}

/**
 * One block of a saved report. A report section carries a small label naming
 * the report it comes from, since several share a title ("Headline"); a
 * section that cannot show the picked scope says which scope it needs; a type
 * the catalogue no longer knows renders nothing.
 */
export function ReportBlockView({
  block, sources
}: Props) {
  if (isContentBlock(block)) return <ContentBlockView block={block} />;
  const definition = dataBlockDefinition(block.type);
  if (definition === undefined) return null;
  const { scope } = sources.inputs;
  const everyKeywordNote = definition.everyKeyword === true && scope.kind !== 'all' ? ' · covers every keyword' : '';
  return (
    <div data-block-type={definition.type}>
      {definition.category !== 'reference' && (
        <p className="mb-1 break-after-avoid text-xs font-semibold uppercase tracking-wider text-gray-400">
          {`${categoryLabel(definition.category)}${everyKeywordNote}`}
        </p>
      )}
      {supportsScope(definition, scope)
        ? definition.render(sources)
        : <ReportSectionPlaceholder title={definition.label} variant="empty" message={scopeHint(definition.scopes)} />}
    </div>
  );
}
