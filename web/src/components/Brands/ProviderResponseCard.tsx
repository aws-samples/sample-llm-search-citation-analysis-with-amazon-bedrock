import { useState } from 'react';
import type {
  AggregatedBrand, ProviderBrandData 
} from '../../types';
import {
  formatResponse, extractUrls, findMentionPositions 
} from '../ui/MarkdownProcessor';

interface ProviderResponseCardProps {
  provider: ProviderBrandData;
  brand: AggregatedBrand;
  keyword: string;
}

const getSentimentColor = (sentiment: string): string => {
  if (sentiment === 'positive') return 'text-green-600';
  if (sentiment === 'negative') return 'text-red-600';
  return 'text-gray-600';
};

const getDisplayText = (fullText: string, isExpanded: boolean): string => {
  if (isExpanded || fullText.length <= 300) return fullText;
  return fullText.slice(0, 300) + '...';
};

const getCitationUrls = (provider: ProviderBrandData, fullText: string): string[] => {
  return (provider.citations?.length ?? 0) > 0 
    ? provider.citations ?? []
    : extractUrls(fullText);
};

const CitationsList = ({ 
  urls, 
  provider, 
  showAll, 
  onToggleShowAll 
}: { 
  urls: string[]; 
  provider: ProviderBrandData; 
  showAll: boolean; 
  onToggleShowAll: () => void; 
}) => {
  if (urls.length === 0) {
    return (
      <div className="mt-6 pt-4 border-t border-gray-200">
        <p className="text-sm text-gray-500 italic">No citations found in this response</p>
      </div>
    );
  }

  const visibleUrls = showAll ? urls : urls.slice(0, 5);

  return (
    <div className="mt-6 pt-4 border-t border-gray-200">
      <h4 className="text-sm font-semibold text-gray-900 mb-3">Citations ({urls.length})</h4>
      <div className="space-y-2">
        {visibleUrls.map((url) => (
          <a
            key={`citation-${provider.provider}-${url.slice(-20)}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-sm text-blue-600 hover:text-blue-800 hover:underline truncate"
            title={url}
          >
            {url}
          </a>
        ))}
        {urls.length > 5 && (
          <button
            onClick={onToggleShowAll}
            className="text-xs text-gray-600 hover:text-gray-800 font-medium"
          >
            {showAll ? '▲ Show Less' : `▼ Show ${urls.length - 5} More Citations`}
          </button>
        )}
      </div>
    </div>
  );
};

interface BrandData {
  rank: number;
  sentiment?: string;
  mention_count?: number;
  ranking_context?: string;
}

const MentionStats = ({ 
  brandData, 
  mentionCount, 
  mentionPositions 
}: { 
  brandData: BrandData | undefined; 
  mentionCount: number; 
  mentionPositions: number[]; 
}) => {
  if (!brandData || mentionCount === 0) return null;
  
  return (
    <div className="px-4 sm:px-6 py-3 bg-purple-50 border-b border-purple-100">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
        <div className="text-sm text-purple-900">
          <span className="font-semibold">{mentionCount} mention(s)</span> found in this response
        </div>
        {mentionPositions.length > 0 && (
          <div className="text-xs text-purple-700">
            Positions: {mentionPositions.slice(0, 5).map((p, idx) => `pos-${idx}-${Math.floor(p / 100)}`).join(', ')}
            {mentionPositions.length > 5 && '...'}
          </div>
        )}
      </div>
    </div>
  );
};

const ResponseHeader = ({ 
  provider, 
  brandData 
}: { 
  provider: ProviderBrandData; 
  brandData: BrandData | undefined; 
}) => (
  <div className="bg-gray-50 px-4 sm:px-6 py-4 border-b border-gray-200">
    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
      <div>
        <h3 className="text-base sm:text-lg font-bold text-gray-900">{provider.provider.toUpperCase()} Response</h3>
        <p className="text-xs sm:text-sm text-gray-600 mt-1">
          {new Date(provider.timestamp).toLocaleString()}
        </p>
      </div>
      {brandData && (
        <div className="text-left sm:text-right">
          <div className="text-sm text-gray-600">
            Rank: <span className="font-bold text-gray-900">#{brandData.rank}</span>
          </div>
          {brandData.sentiment && (
            <div className="text-sm text-gray-600 mt-1">
              Sentiment:{' '}
              <span className={`font-medium ${getSentimentColor(brandData.sentiment)}`}>
                {brandData.sentiment}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  </div>
);

const FeedbackSection = ({ 
  title, 
  content, 
  isExpanded, 
  onToggle, 
  bgColor = 'bg-gray-50 hover:bg-gray-100',
  titleColor = 'text-gray-900' 
}: { 
  title: string; 
  content: string; 
  isExpanded: boolean; 
  onToggle: () => void;
  bgColor?: string;
  titleColor?: string;
}) => (
  <div className="mt-4 border border-green-200 rounded-lg overflow-hidden">
    <button
      onClick={onToggle}
      className={`w-full px-4 py-3 ${bgColor} transition-colors flex items-center justify-between`}
    >
      <span className={`text-sm font-medium ${titleColor}`}>{title}</span>
      <span className="text-gray-600">{isExpanded ? '▲' : '▼'}</span>
    </button>
    {isExpanded && (
      <div className="px-4 py-3 bg-white">
        <div className="prose prose-sm max-w-none text-gray-700">
          {formatResponse(content)}
        </div>
      </div>
    )}
  </div>
);

export const ProviderResponseCard = ({
  provider, brand 
}: ProviderResponseCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAllCitations, setShowAllCitations] = useState(false);
  const [showSeoFeedback, setShowSeoFeedback] = useState(false);
  const [showGeoFeedback, setShowGeoFeedback] = useState(false);
  
  const brandData = provider.brands.find((b) => b.name.toLowerCase() === brand.name.toLowerCase());
  const fullText = provider.full_response ?? provider.response_preview;
  const urls = getCitationUrls(provider, fullText);
  const mentionPositions = brandData ? findMentionPositions(fullText, brand.name) : [];
  const mentionCount = brandData?.mention_count ?? mentionPositions.length;
  const displayText = getDisplayText(fullText, isExpanded);

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <ResponseHeader provider={provider} brandData={brandData} />
      <MentionStats brandData={brandData} mentionCount={mentionCount} mentionPositions={mentionPositions} />

      {/* Response Content */}
      <div className="px-4 sm:px-6 py-4">
        <div className="prose prose-sm max-w-none">
          {formatResponse(displayText)}
        </div>
        {fullText.length > 300 && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="mt-4 text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
          >
            {isExpanded ? '▲ Collapse' : '▼ Expand Full Response'}
          </button>
        )}

        <CitationsList 
          urls={urls} 
          provider={provider} 
          showAll={showAllCitations} 
          onToggleShowAll={() => setShowAllCitations(!showAllCitations)} 
        />

        {/* Brand Context */}
        {brandData?.ranking_context && (
          <div className="mt-4 p-3 bg-blue-50 rounded-lg">
            <p className="text-sm text-blue-900">
              <span className="font-semibold">Context:</span> {brandData.ranking_context}
            </p>
          </div>
        )}

        {/* SEO Feedback */}
        {provider.seo_feedback && (
          <FeedbackSection
            title="SEO Analysis"
            content={provider.seo_feedback}
            isExpanded={showSeoFeedback}
            onToggle={() => setShowSeoFeedback(!showSeoFeedback)}
          />
        )}

        {/* GEO Feedback */}
        {provider.geo_feedback && (
          <FeedbackSection
            title="🌍 Geographic Analysis"
            content={provider.geo_feedback}
            isExpanded={showGeoFeedback}
            onToggle={() => setShowGeoFeedback(!showGeoFeedback)}
            bgColor="bg-blue-50 hover:bg-blue-100"
            titleColor="text-blue-900"
          />
        )}
      </div>
    </div>
  );
};
