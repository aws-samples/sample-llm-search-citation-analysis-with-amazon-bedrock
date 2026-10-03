import {
  useMemo, useState
} from 'react';
import type { CompetitorAnalysisResult } from '../../types';
import { useRunPromotion } from './useRunPromotion';
import { KeywordPromotionControls } from './KeywordPromotionControls';
import { ResearchRunStatus } from './ResearchRunStatus';
import type { ResearchRunViewProps } from './researchRunView';
import {
  InputForm,
  SummaryCard,
  SectionTabs,
  KeywordsTable,
  getKeywordsForSection,
  type SectionId,
} from './CompetitorAnalysisComponents';

interface CompetitorAnalysisProps extends ResearchRunViewProps {
  onAnalyze: (url: string) => Promise<void>;
  result: CompetitorAnalysisResult | null;
}

export const CompetitorAnalysis = ({
  onAnalyze,
  loading,
  result,
  error,
  activeJob = null,
  onRetry,
  onKeywordsAdded,
}: CompetitorAnalysisProps) => {
  const [url, setUrl] = useState('');
  const [activeSection, setActiveSection] = useState<SectionId>('primary');

  const currentKeywords = useMemo(
    () => getKeywordsForSection(result, activeSection),
    [result, activeSection]
  );
  // Each section is a distinct set of research keywords (a new array per result and
  // section), so a section switch clears the selection just like a new result does.
  const promotion = useRunPromotion(currentKeywords, onKeywordsAdded, currentKeywords);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    await onAnalyze(url.trim());
  };

  return (
    <div className="space-y-6">
      <InputForm url={url} setUrl={setUrl} loading={loading} onSubmit={handleSubmit} />

      <ResearchRunStatus jobType="competitor" loading={loading} error={error} activeJob={activeJob} onRetry={onRetry} />

      {result && (
        <div className="space-y-4">
          <SummaryCard result={result} />
          <KeywordPromotionControls promotion={promotion} />
          <div className="bg-white rounded-lg border border-gray-200">
            <SectionTabs activeSection={activeSection} setActiveSection={setActiveSection} result={result} />
            <KeywordsTable
              keywords={currentKeywords}
              showOpportunity={activeSection === 'gaps'}
              selectable
              selected={promotion.selectedKeys}
              onToggle={promotion.toggle}
            />
          </div>
        </div>
      )}
    </div>
  );
};
