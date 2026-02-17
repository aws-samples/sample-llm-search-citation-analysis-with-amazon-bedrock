import { useState } from 'react';
import type { CompetitorAnalysisResult } from '../../types';
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
}

export const CompetitorAnalysis = ({
  onAnalyze,
  loading,
  result,
  error,
}: CompetitorAnalysisProps) => {
  const [url, setUrl] = useState('');
  const [activeSection, setActiveSection] = useState<SectionId>('primary');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    await onAnalyze(url.trim());
  };

  const currentKeywords = getKeywordsForSection(result, activeSection);

  return (
    <div className="space-y-6">
      <InputForm url={url} setUrl={setUrl} loading={loading} onSubmit={handleSubmit} />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
      )}

      {result && (
        <div className="space-y-4">
          <SummaryCard result={result} />
          <div className="bg-white rounded-lg border border-gray-200">
            <SectionTabs activeSection={activeSection} setActiveSection={setActiveSection} result={result} />
            <KeywordsTable keywords={currentKeywords} showOpportunity={activeSection === 'gaps'} />
          </div>
        </div>
      )}
    </div>
  );
};
