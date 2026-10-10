import {
  useId, useState
} from 'react';
import { Modal } from '../ui/Modal';
import {
  TabBar, TabPanel, type TabDefinition
} from '../ui/TabBar';
import { AboutTab } from './AboutTab';
import { ArchitectureTab } from './ArchitectureTab';
import { LicensesTab } from './LicensesTab';
import { VersionTab } from './VersionTab';

interface AboutModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

type TabType = 'about' | 'architecture' | 'licenses' | 'version';

const TABS: ReadonlyArray<TabDefinition<TabType>> = [
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
  const panelId = useId();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Citation Analysis System" size="4xl">
      <TabBar tabs={TABS} activeId={activeTab} onChange={setActiveTab} label="About this system" panelId={panelId} />

      <TabPanel id={panelId} activeId={activeTab} className="pt-6">
        {activeTab === 'about' && <AboutTab />}
        {activeTab === 'architecture' && <ArchitectureTab />}
        {activeTab === 'licenses' && <LicensesTab />}
        {activeTab === 'version' && <VersionTab />}
      </TabPanel>
    </Modal>
  );
};
