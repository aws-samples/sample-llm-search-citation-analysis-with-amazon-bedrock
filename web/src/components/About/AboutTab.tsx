export function AboutTab() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-gray-900 mb-3">The Future of Discoverability</h3>
        <p className="text-sm text-gray-600 leading-relaxed">
          The future of discoverability is shifting. People are discovering brands in different ways — through AI-powered 
          search engines, conversational assistants, and large language models that synthesize information from across the web.
        </p>
        <p className="text-sm text-gray-600 leading-relaxed mt-3">
          We built this software to help track LLM results, the citations in the websites they use as trusted data sources, 
          and understand where information is being picked up. This enables businesses to position themselves in those sources 
          or build new sources that get picked up and see how they start to rank within LLMs.
        </p>
        <p className="text-sm text-gray-600 leading-relaxed mt-3">
          This is an <span className="font-medium text-gray-900">art of the possible</span> — demonstrating what can be done 
          and how we can support companies as discoverability shifts towards new channels and platforms.
        </p>
      </div>

      <div className="border-t border-gray-200 pt-6">
        <h3 className="text-base font-semibold text-gray-900 mb-3">Built By</h3>
        <div className="flex items-start gap-4">
          <img 
            src="/assets/matiasunderraga.jpg" 
            alt="Matias Undurraga"
            className="w-12 h-12 rounded-full object-cover object-[center_30%] flex-shrink-0"
          />
          <div>
            <h4 className="text-sm font-semibold text-gray-900">Matias Undurraga</h4>
            <p className="text-sm text-gray-500 mb-2">Enterprise Technologist at AWS</p>
            <p className="text-sm text-gray-600 leading-relaxed">
              Based in Zürich, Matias works with enterprise customers across Europe on cloud adoption, platform strategy, and AI/ML implementation—helping organisations rethink their digital strategies for an AI-first world.
            </p>
            <a 
              href="https://www.linkedin.com/in/matiasundurraga/" 
              target="_blank" 
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 mt-3 text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
              </svg>
              Connect on LinkedIn
            </a>
          </div>
        </div>

        {/* Christian Wolff */}
        <div className="flex items-start gap-4 mt-6">
          <img 
            src="/assets/christianwolff.jpg" 
            alt="Christian Wolff"
            className="w-12 h-12 rounded-full object-cover object-top flex-shrink-0"
          />
          <div>
            <h4 className="text-sm font-semibold text-gray-900">Christian Wolff</h4>
            <p className="text-sm text-gray-500 mb-2">Solutions Architect at AWS</p>
            <p className="text-sm text-gray-600 leading-relaxed">
              Based in London, Christian works with Travel & Hospitality customers on generative AI adoption and AI-assisted development. He leads the UK Travel & Hospitality Future of Search initiative, exploring how AI is reshaping how customers discover and book travel.
            </p>
            <a 
              href="https://www.linkedin.com/in/christian--wolff/" 
              target="_blank" 
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 mt-3 text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
              </svg>
              Connect on LinkedIn
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
