const AI_PROVIDERS = [
  {
    name: 'OpenAI',
    model: 'GPT-5 mini',
    color: 'bg-gray-50 border-gray-200 text-emerald-800' 
  },
  {
    name: 'Perplexity',
    model: 'Sonar',
    color: 'bg-blue-50 border-blue-200 text-blue-800' 
  },
  {
    name: 'Google',
    model: 'Gemini',
    color: 'bg-red-50 border-red-200 text-red-800' 
  },
  {
    name: 'Anthropic',
    model: 'Claude',
    color: 'bg-gray-50 border-gray-200 text-amber-800' 
  },
];

const SEARCH_PROVIDERS = ['Brave Search', 'Tavily', 'Exa', 'SerpAPI', 'Firecrawl', 'Amazon Bedrock Web Search'];

const CAPABILITIES = [
  {
    icon: '🔍',
    title: 'Multi-Provider Search',
    desc: 'Query multiple AI engines simultaneously' 
  },
  {
    icon: '🏷️',
    title: 'Brand Extraction',
    desc: 'LLM-powered brand mention analysis' 
  },
  {
    icon: '📊',
    title: 'Visibility Scoring',
    desc: 'Track share of voice across providers' 
  },
  {
    icon: '🔗',
    title: 'Citation Tracking',
    desc: 'Monitor which sources get cited' 
  },
  {
    icon: '📈',
    title: 'Trend Analysis',
    desc: 'Historical visibility trends' 
  },
  {
    icon: '💡',
    title: 'Recommendations',
    desc: 'Actionable insights to improve ranking' 
  },
  {
    icon: '👥',
    title: 'Personas',
    desc: 'See how responses change based on who is asking' 
  },
  {
    icon: '⏰',
    title: 'Scheduled Runs',
    desc: 'EventBridge schedules, optionally scoped to keyword subsets' 
  },
  {
    icon: '📄',
    title: 'Reports',
    desc: 'Executive summaries and competitor gap reports' 
  },
];

/** One tier of the request path in the diagram: its service and what it does. */
function TierBox({
  title, subtitle
}: {
  readonly title: string;
  readonly subtitle: string;
}) {
  return (
    <div className="bg-white border border-gray-300 rounded-lg px-6 py-3 text-sm font-medium text-gray-700 shadow-sm mb-2">
      <div className="text-center">
        <div className="font-semibold">{title}</div>
        <div className="text-xs text-gray-500">{subtitle}</div>
      </div>
    </div>
  );
}

export function ArchitectureTab() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-gray-900 mb-3">System Architecture</h3>
        <p className="text-sm text-gray-600 mb-4">
          A serverless AWS application that monitors how AI search engines mention and rank brands in their responses.
        </p>
      </div>

      <div className="bg-gray-50 rounded-lg p-6 border border-gray-200">
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-4 mb-4">
            <div className="bg-white border border-gray-300 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 shadow-sm">
              User
            </div>
          </div>
          <div className="w-px h-6 bg-gray-300"></div>
          
          <TierBox title="React Dashboard" subtitle="CloudFront + S3" />
          <div className="w-px h-6 bg-gray-300"></div>

          <TierBox title="API Gateway" subtitle="REST API + Cognito Auth" />
          <div className="w-px h-6 bg-gray-300"></div>

          <div className="flex items-center gap-4 mb-2">
            <div className="bg-white border border-gray-300 rounded-lg px-4 py-3 text-sm shadow-sm">
              <div className="text-center">
                <div className="font-semibold text-gray-700">Step Functions</div>
                <div className="text-xs text-gray-500">Workflow Orchestration</div>
              </div>
            </div>
            <div className="bg-white border border-gray-300 rounded-lg px-4 py-3 text-sm shadow-sm">
              <div className="text-center">
                <div className="font-semibold text-gray-700">EventBridge Scheduler</div>
                <div className="text-xs text-gray-500">Automated Runs</div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-16 h-px bg-gray-300"></div>
            <div className="w-px h-6 bg-gray-300"></div>
            <div className="w-16 h-px bg-gray-300"></div>
          </div>

          <div className="flex flex-wrap justify-center gap-3 mb-4">
            {['Parse', 'Search', 'Dedupe', 'Crawl', 'Summarize'].map((fn) => (
              <div key={fn} className="bg-gray-50 border border-gray-200 rounded px-3 py-2 text-xs font-medium text-amber-800">
                λ {fn}
              </div>
            ))}
          </div>
          <div className="w-px h-6 bg-gray-300"></div>

          <div className="flex flex-wrap justify-center gap-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-sm">
              <div className="font-semibold text-blue-800">DynamoDB</div>
              <div className="text-xs text-blue-700">Data Storage</div>
            </div>
            <div className="bg-violet-50 border border-violet-200 rounded-lg px-4 py-2 text-sm">
              <div className="font-semibold text-violet-800">Bedrock</div>
              <div className="text-xs text-violet-700">Brand Extraction</div>
            </div>
            <div className="bg-violet-50 border border-violet-200 rounded-lg px-4 py-2 text-sm">
              <div className="font-semibold text-violet-800">Bedrock AgentCore</div>
              <div className="text-xs text-violet-700">Browser Crawling</div>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-sm">
              <div className="font-semibold text-emerald-800">S3</div>
              <div className="text-xs text-emerald-700">Raw Responses</div>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-gray-900 mb-3">AI Search Providers</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {AI_PROVIDERS.map((provider) => (
            <div key={provider.name} className={`${provider.color} border rounded-lg px-3 py-2 text-center`}>
              <div className="text-sm font-medium">{provider.name}</div>
              <div className="text-xs opacity-75">{provider.model}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {SEARCH_PROVIDERS.map((provider) => (
            <span key={provider} className="text-xs bg-gray-50 text-gray-700 border border-gray-200 px-2 py-1 rounded">
              {provider}
            </span>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Optional web search providers complement the LLM providers during analysis runs.
        </p>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-gray-900 mb-3">Key Capabilities</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {CAPABILITIES.map((feature) => (
            <div key={feature.title} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
              <span className="text-lg">{feature.icon}</span>
              <div>
                <div className="text-sm font-medium text-gray-900">{feature.title}</div>
                <div className="text-xs text-gray-500">{feature.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
