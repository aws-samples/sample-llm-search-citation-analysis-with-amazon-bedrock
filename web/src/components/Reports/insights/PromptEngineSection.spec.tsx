import {
  describe, expect, it
} from 'vitest';
import {
  render, screen, within
} from '@testing-library/react';
import { KPI_DEFINITIONS } from '../../../constants/kpiDefinitions';
import {
  buildPromptEngine, buildPromptEngineRow
} from '../../../types/domain/insightFacts-fixtures';
import { sectionTitled } from '../layout/reportQueries-fixtures';
import {
  columnTooltip, describeInsightsSectionPlaceholders, expectEmptySection, insightLines, insightsWithFacts, loadedInsights, sectionColumnHeadings,
  sectionRows
} from './insightSections-fixtures';
import {
  PROMPT_ENGINE_EMPTY, PROMPT_ENGINE_TITLE, PromptEngineSection
} from './PromptEngineSection';

function renderPrompts(slice = loadedInsights()) {
  return render(<PromptEngineSection {...slice} />);
}

describe('PromptEngineSection', () => {
  it('heads the keyword, its visibility score and one column per engine that answered', () => {
    renderPrompts();

    expect(sectionColumnHeadings(PROMPT_ENGINE_TITLE)).toStrictEqual(['Keyword', 'Visibility score', 'Google Gemini', 'OpenAI']);
  });

  it('explains the visibility score with its definition', () => {
    renderPrompts();

    expect(columnTooltip('Visibility score')).toHaveAccessibleDescription(KPI_DEFINITIONS.visibility_score.definition);
  });

  it('lists the weakest keyword first, saying in words which cells fall below the top 3', () => {
    renderPrompts();

    expect(sectionRows(PROMPT_ENGINE_TITLE)).toStrictEqual([
      ['cheap flights to Lima', '12.5', 'Not named, below the top 3', '5, below the top 3'],
      ['Best airline to fly from Europe to South America', '61.3', '2', '4, below the top 3'],
    ]);
  });

  it('highlights a lost cell and leaves a top-3 cell plain', () => {
    renderPrompts();

    const table = within(sectionTitled(PROMPT_ENGINE_TITLE));
    expect(table.getByText('4')).toHaveClass('bg-red-50');
    expect(table.getByText('2')).not.toHaveClass('bg-red-50');
  });

  it('writes a dash, read as not answered, for an engine that did not answer the keyword', () => {
    renderPrompts(insightsWithFacts({
      prompt_engine: buildPromptEngine({
        keywords: [buildPromptEngineRow({
          positions: { openai: 5 },
          lost_engines: ['openai'] 
        })] 
      }) 
    }));

    expect(sectionRows(PROMPT_ENGINE_TITLE)[0]).toStrictEqual(['cheap flights to Lima', '12.5', '—Not answered', '5, below the top 3']);
  });

  it('reads out the prompt-gap insight above the table, and no other insight', () => {
    renderPrompts();

    expect(insightLines(PROMPT_ENGINE_TITLE)).toStrictEqual([
      'cheap flights to Lima: outside the top 3 on every AI engine that answered; best position 5, named by 1 of 2 engines.',
    ]);
  });

  it.each([
    [1, '1 more keyword with a higher visibility score is not shown.'],
    [12, '12 more keywords with a higher visibility score are not shown.'],
  ])('says %i keywords were left out beyond the cap', (omitted, note) => {
    renderPrompts(insightsWithFacts({ prompt_engine: buildPromptEngine({ omitted }) }));

    expect(screen.getByText(note)).toBeInTheDocument();
  });

  it('says nothing was left out when every keyword is shown', () => {
    renderPrompts();

    expect(screen.queryByText(/not shown/u)).not.toBeInTheDocument();
  });

  it('says no engine answered, without a table, when no keyword has an answer', () => {
    renderPrompts(insightsWithFacts({
      prompt_engine: buildPromptEngine({
        keywords: [],
        engines: [] 
      }) 
    }));

    expectEmptySection(PROMPT_ENGINE_TITLE, PROMPT_ENGINE_EMPTY);
  });

  describeInsightsSectionPlaceholders(PromptEngineSection);
});
