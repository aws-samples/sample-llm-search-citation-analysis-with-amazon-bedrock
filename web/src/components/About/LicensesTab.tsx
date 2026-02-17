const FRONTEND_DEPS = [
  {
    name: 'React',
    version: '18.x',
    license: 'MIT',
    desc: 'UI framework' 
  },
  {
    name: 'TypeScript',
    version: '5.x',
    license: 'Apache-2.0',
    desc: 'Type safety' 
  },
  {
    name: 'Vite',
    version: '5.x',
    license: 'MIT',
    desc: 'Build tool' 
  },
  {
    name: 'Tailwind CSS',
    version: '3.x',
    license: 'MIT',
    desc: 'Utility CSS' 
  },
  {
    name: 'Chart.js',
    version: '4.x',
    license: 'MIT',
    desc: 'Charts' 
  },
  {
    name: 'xlsx-js-style',
    version: '1.x',
    license: 'Apache-2.0',
    desc: 'Excel export' 
  },
  {
    name: 'AWS Amplify',
    version: '6.x',
    license: 'Apache-2.0',
    desc: 'Auth SDK' 
  },
  {
    name: 'DOMPurify',
    version: '3.x',
    license: 'Apache-2.0',
    desc: 'XSS protection' 
  },
];

const BACKEND_DEPS = [
  {
    name: 'Python',
    version: '3.12',
    license: 'PSF',
    desc: 'Runtime' 
  },
  {
    name: 'Boto3',
    version: '1.x',
    license: 'Apache-2.0',
    desc: 'AWS SDK' 
  },
  {
    name: 'Requests',
    version: '2.x',
    license: 'Apache-2.0',
    desc: 'HTTP client' 
  },
  {
    name: 'BeautifulSoup4',
    version: '4.x',
    license: 'MIT',
    desc: 'HTML parsing' 
  },
  {
    name: 'AWS CDK',
    version: '2.x',
    license: 'Apache-2.0',
    desc: 'Infrastructure' 
  },
];

const AWS_SERVICES = [
  'Lambda', 'DynamoDB', 'Step Functions', 'API Gateway', 'S3', 
  'CloudFront', 'Cognito', 'Bedrock', 'Secrets Manager', 'EventBridge', 'WAF'
];

const USE_CASES = [
  {
    icon: '🔍',
    title: 'Product Research',
    examples: '"best wireless headphones 2025", "top CRM software"' 
  },
  {
    icon: '🏢',
    title: 'Competitive Intelligence',
    examples: '"leading companies in AI automation"' 
  },
  {
    icon: '⭐',
    title: 'Review Analysis',
    examples: '"best restaurants in Barcelona", "top hotels in Tokyo"' 
  },
  {
    icon: '📈',
    title: 'Market Research',
    examples: '"emerging trends in fintech"' 
  },
  {
    icon: '🎯',
    title: 'SEO Research',
    examples: 'Track which domains AI providers cite' 
  },
  {
    icon: '👁️',
    title: 'Brand Monitoring',
    examples: 'See which sources mention your brand' 
  },
];

function DependencyItem({ dep }: {
  readonly dep: {
    name: string;
    version: string;
    license: string 
  } 
}) {
  return (
    <div className="flex items-center justify-between p-2 bg-white rounded border border-gray-200">
      <div>
        <span className="text-sm font-medium text-gray-900">{dep.name}</span>
        <span className="text-xs text-gray-500 ml-2">{dep.version}</span>
      </div>
      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{dep.license}</span>
    </div>
  );
}

export function LicensesTab() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-gray-900 mb-3">Open Source Software</h3>
        <p className="text-sm text-gray-600 mb-4">
          This project is built with open source technologies and libraries. We're grateful to the communities 
          that make these tools available.
        </p>
      </div>

      <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
        <h4 className="text-sm font-semibold text-gray-900 mb-2">Project License</h4>
        <p className="text-sm text-gray-600">
          This project is released under the <span className="font-medium">MIT No Attribution (MIT-0) License</span>. 
          You are free to use, modify, and distribute this software.
        </p>
        <a 
          href="https://opensource.org/license/mit-0" 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-xs text-gray-500 hover:text-gray-700 mt-1 inline-block"
        >
          https://opensource.org/license/mit-0
        </a>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-gray-900 mb-3">Frontend Technologies</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {FRONTEND_DEPS.map((dep) => <DependencyItem key={dep.name} dep={dep} />)}
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-gray-900 mb-3">Backend Technologies</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {BACKEND_DEPS.map((dep) => <DependencyItem key={dep.name} dep={dep} />)}
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-gray-900 mb-3">AWS Services</h4>
        <div className="flex flex-wrap gap-2">
          {AWS_SERVICES.map((service) => (
            <span key={service} className="text-xs bg-amber-50 text-amber-800 border border-amber-200 px-2 py-1 rounded">
              {service}
            </span>
          ))}
        </div>
      </div>

      <div className="border-t border-gray-200 pt-6">
        <h4 className="text-sm font-semibold text-gray-900 mb-3">Example Use Cases</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {USE_CASES.map((useCase) => (
            <div key={useCase.title} className="p-3 bg-gray-50 rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                <span>{useCase.icon}</span>
                <span className="text-sm font-medium text-gray-900">{useCase.title}</span>
              </div>
              <p className="text-xs text-gray-500">{useCase.examples}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-gray-200 pt-6">
        <h4 className="text-sm font-semibold text-gray-900 mb-2">Acknowledgments</h4>
        <p className="text-sm text-gray-600">
          Built with AWS CDK and serverless technologies. Browser automation powered by Amazon Bedrock AgentCore. 
          Dashboard built with React and Tailwind CSS. Inspired by enterprise web intelligence patterns.
        </p>
      </div>
    </div>
  );
}
