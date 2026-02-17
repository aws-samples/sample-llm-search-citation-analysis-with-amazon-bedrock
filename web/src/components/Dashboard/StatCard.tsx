interface StatCardProps {
  title: string;
  value: number;
  icon: string;
}

const iconMap: Record<string, JSX.Element> = {
  '🔍': (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  ),
  '📎': (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
    </svg>
  ),
  '🕷️': (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
    </svg>
  ),
  '🔑': (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
    </svg>
  ),
};

const colorMap: Record<string, { bg: string; text: string; border: string }> = {
  '🔍': { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-100' },
  '📎': { bg: 'bg-violet-50', text: 'text-violet-600', border: 'border-violet-100' },
  '🕷️': { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-100' },
  '🔑': { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-100' },
};

export const StatCard = ({
  title, value, icon 
}: StatCardProps) => {
  const colors = colorMap[icon] ?? { bg: 'bg-gray-50', text: 'text-gray-500', border: 'border-gray-100' };

  return (
    <div className={`bg-white rounded-lg border ${colors.border} p-6`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-gray-500 text-sm mb-1">{title}</p>
          <p className="text-3xl font-semibold text-gray-900">{value.toLocaleString()}</p>
        </div>
        <div className={`${colors.bg} ${colors.text} p-3 rounded-xl`}>
          {iconMap[icon] || <span className="text-2xl">{icon}</span>}
        </div>
      </div>
    </div>
  );
};
