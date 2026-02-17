const AI_PROVIDERS = [
  {
    name: 'OpenAI',
    model: 'GPT-5 mini',
    color: 'bg-emerald-50 border-emerald-200 text-emerald-800' 
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
    color: 'bg-orange-50 border-orange-200 text-orange-800' 
  },
];

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
];

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
              👤 User
            </div>
          </div>
          <div className="w-px h-6 bg-gray-300"></div>
          
          <div className="bg-white border border-gray-300 rounded-lg px-6 py-3 text-sm font-medium text-gray-700 shadow-sm mb-2">
            <div className="text-center">
              <div className="font-semibold">React Dashboard</div>
              <div className="text-xs text-gray-500">CloudFront + S3</div>
            </div>
          </div>
          <div className="w-px h-6 bg-gray-300"></div>

          <div className="bg-white border border-gray-300 rounded-lg px-6 py-3 text-sm font-medium text-gray-700 shadow-sm mb-2">
            <div className="text-center">
              <div className="font-semibold">API Gateway</div>
              <div className="text-xs text-gray-500">REST API + Cognito Auth + WAF</div>
            </div>
          </div>
          <div className="w-px h-6 bg-gray-300"></div>

          <div className="flex items-center gap-4 mb-2">
            <div className="bg-white border border-gray-300 rounded-lg px-4 py-3 text-sm shadow-sm">
              <div className="text-center">
                <div className="font-semibold text-gray-700">Step Functions</div>
                <div className="text-xs text-gray-500">Workflow Orchestration</div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-16 h-px bg-gray-300"></div>
            <div className="w-px h-6 bg-gray-300"></div>
            <div className="w-16 h-px bg-gray-300"></div>
          </div>

          <div className="flex flex-wrap justify-center gap-3 mb-4">
            {['Search', 'Crawl', 'Dedupe', 'Extract'].map((fn) => (
              <div key={fn} className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-xs font-medium text-amber-800">
                λ {fn}
              </div>
            ))}
          </div>
          <div className="w-px h-6 bg-gray-300"></div>

          <div className="flex flex-wrap justify-center gap-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-sm">
              <div className="font-semibold text-blue-800">DynamoDB</div>
              <div className="text-xs text-blue-600">Data Storage</div>
            </div>
            <div className="bg-purple-50 border border-purple-200 rounded-lg px-4 py-2 text-sm">
              <div className="font-semibold text-purple-800">Bedrock</div>
              <div className="text-xs text-purple-600">Brand Extraction</div>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 text-sm">
              <div className="font-semibold text-green-800">S3</div>
              <div className="text-xs text-green-600">Raw Responses</div>
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
