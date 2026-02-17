import { useState } from 'react';
import { AboutTab } from './AboutTab';
import { ArchitectureTab } from './ArchitectureTab';
import { LicensesTab } from './LicensesTab';

interface AboutModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

type TabType = 'about' | 'architecture' | 'licenses';

interface TabConfig {
  readonly id: TabType;
  readonly label: string;
}

const TABS: readonly TabConfig[] = [
  {
    id: 'about',
    label: 'About' 
  },
  {
    id: 'architecture',
    label: 'Architecture' 
  },
  {
    id: 'licenses',
    label: 'Open Source' 
  },
];

export const AboutModal = ({
  isOpen, onClose 
}: AboutModalProps) => {
  const [activeTab, setActiveTab] = useState<TabType>('about');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 !mt-0">
      <div className="bg-white rounded-lg border border-gray-200 max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Citation Analysis System</h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-4">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'about' && <AboutTab />}
          {activeTab === 'architecture' && <ArchitectureTab />}
          {activeTab === 'licenses' && <LicensesTab />}
        </div>
      </div>
    </div>
  );
};
