interface DomainListProps {
  readonly domains: string[];
  readonly newDomain: string;
  readonly onNewDomainChange: (value: string) => void;
  readonly onAddDomain: () => void;
  readonly onRemoveDomain: (domain: string) => void;
}

export const DomainList = ({
  domains,
  newDomain,
  onNewDomainChange,
  onAddDomain,
  onRemoveDomain,
}: DomainListProps) => (
  <div className="bg-emerald-50/50 rounded-lg p-4 border border-emerald-200">
    <h3 className="text-sm font-semibold text-emerald-800 mb-2">First Party Domains</h3>
    <p className="text-xs text-emerald-700 mb-3">
      Your website domains. URLs from these domains will be excluded from Citation Gaps analysis.
    </p>
    <div className="flex gap-2 mb-3">
      <input
        type="text"
        value={newDomain}
        onChange={(e) => onNewDomainChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onAddDomain()}
        placeholder="e.g., example.com, brand.com"
        className="flex-1 p-2 border border-emerald-300 rounded-lg focus:ring-2 focus:ring-emerald-500 bg-white text-sm"
      />
      <button
        onClick={onAddDomain}
        className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors"
      >
        Add
      </button>
    </div>
    <div className="flex flex-wrap gap-2">
      {domains.map((domain) => (
        <span
          key={domain}
          className="px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-sm flex items-center gap-2 font-mono"
        >
          {domain}
          <button
            onClick={() => onRemoveDomain(domain)}
            className="text-emerald-600 hover:text-emerald-800 font-bold"
          >
            ×
          </button>
        </span>
      ))}
      {domains.length === 0 && (
        <span className="text-sm text-emerald-600 italic">
          No domains added — brand name matching will be used as fallback
        </span>
      )}
    </div>
  </div>
);
