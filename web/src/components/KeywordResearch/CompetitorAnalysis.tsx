import {
  useEffect, useMemo, useState 
} from 'react';
import type {
  CompetitorAnalysisResult, Keyword 
} from '../../types';
import { usePromoteKeywords } from '../../hooks/usePromoteKeywords';
import { KeywordPromotionControls } from './KeywordPromotionControls';
import {
  InputForm,
  SummaryCard,
  SectionTabs,
  KeywordsTable,
  getKeywordsForSection,
  type SectionId,
} from './CompetitorAnalysisComponents';

interface CompetitorAnalysisProps {
  onAnalyze: (url: string) => Promise<void>;
  loading: boolean;
  result: CompetitorAnalysisResult | null;
  error: string | null;
  onKeywordsAdded?: (created: Keyword[]) => void;
}

export const CompetitorAnalysis = ({
  onAnalyze,
  loading,
  result,
  error,
  onKeywordsAdded,
}: CompetitorAnalysisProps) => {
  const [url, setUrl] = useState('');
  const [activeSection, setActiveSection] = useState<SectionId>('primary');

  const currentKeywords = useMemo(
    () => getKeywordsForSection(result, activeSection),
    [result, activeSection]
  );
  const promotion = usePromoteKeywords(currentKeywords, onKeywordsAdded);
  const { clearSelection } = promotion;
  const selectedKeywords = useMemo(() => new Set(promotion.selected), [promotion.selected]);

  // Each section is a distinct set of research keywords, so a section switch clears
  // the selection just like a new result does: a promotion must never carry keywords
  // the user can no longer see.
  useEffect(() => {
    clearSelection();
  }, [result, activeSection, clearSelection]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    await onAnalyze(url.trim());
  };

  return (
    <div className="space-y-6">
      <InputForm url={url} setUrl={setUrl} loading={loading} onSubmit={handleSubmit} />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
      )}

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
              selected={selectedKeywords}
              onToggle={promotion.toggle}
            />
          </div>
        </div>
      )}
    </div>
  );
};
