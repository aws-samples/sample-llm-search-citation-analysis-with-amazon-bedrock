import type { PromptInsight } from '../../types';

const STATUS_STYLES: Record<string, string> = {
  winning: 'bg-green-100 text-green-800',
  losing: 'bg-red-100 text-red-800',
  opportunity: 'bg-yellow-100 text-yellow-800',
  neutral: 'bg-gray-100 text-gray-800'
};

function SideStats({
  label, stats
}: {
  readonly label: string;
  readonly stats: PromptInsight['first_party'] 
}) {
  return (
    <div>
      <div className="text-gray-500 text-xs mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <span className="font-medium">{stats.mentions} mentions</span>
        {stats.best_rank && (
          <span className="text-gray-400">Rank #{stats.best_rank}</span>
        )}
      </div>
      <div className="text-xs text-gray-400">
        {stats.provider_coverage}% provider coverage
      </div>
    </div>
  );
}

export function PromptCard({ prompt }: { readonly prompt: PromptInsight }) {
  return (
    <div className="bg-white p-4 rounded-lg shadow border-l-4 border-l-blue-500">
      <div className="flex justify-between items-start mb-2">
        <h4 className="font-medium text-gray-900">{prompt.keyword}</h4>
        <span className={`px-2 py-1 rounded text-xs ${STATUS_STYLES[prompt.status] ?? STATUS_STYLES.neutral}`}>
          {prompt.status}
        </span>
      </div>
      
      <div className="grid grid-cols-2 gap-4 text-sm">
        <SideStats label="Your Brand" stats={prompt.first_party} />
        <SideStats label="Competitors" stats={prompt.competitors} />
      </div>

      {prompt.score !== undefined && (
        <div className="mt-2 pt-2 border-t border-gray-100">
          <div className="text-xs text-gray-500">
            Score: <span className="font-medium text-green-600">{prompt.score}</span>
          </div>
        </div>
      )}
      {prompt.improvement_potential !== undefined && (
        <div className="mt-2 pt-2 border-t border-gray-100">
          <div className="text-xs text-gray-500">
            Improvement Potential: <span className="font-medium text-red-600">{prompt.improvement_potential}%</span>
          </div>
        </div>
      )}
      {prompt.opportunity_score !== undefined && (
        <div className="mt-2 pt-2 border-t border-gray-100">
          <div className="text-xs text-gray-500">
            Opportunity Score: <span className="font-medium text-yellow-600">{prompt.opportunity_score}</span>
          </div>
        </div>
      )}
    </div>
  );
}
