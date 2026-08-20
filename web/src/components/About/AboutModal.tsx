import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { AboutTab } from './AboutTab';
import { ArchitectureTab } from './ArchitectureTab';
import { LicensesTab } from './LicensesTab';
import { VersionTab } from './VersionTab';

interface AboutModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

type TabType = 'about' | 'architecture' | 'licenses' | 'version';

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
  {
    id: 'version',
    label: 'Version' 
  },
];

// ui/Modal supplies the dialog semantics this component previously lacked
// (bugs.md 4.4 / AUDIT-2026-08-19 §3): role, Escape-to-close, scroll lock,
// backdrop click-close, and a labelled close button.
export const AboutModal = ({
  isOpen, onClose 
}: AboutModalProps) => {
  const [activeTab, setActiveTab] = useState<TabType>('about');

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Citation Analysis System" size="4xl">
      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-gray-900 text-gray-900 dark:border-white dark:text-white'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="pt-6">
        {activeTab === 'about' && <AboutTab />}
        {activeTab === 'architecture' && <ArchitectureTab />}
        {activeTab === 'licenses' && <LicensesTab />}
        {activeTab === 'version' && <VersionTab />}
      </div>
    </Modal>
  );
};
