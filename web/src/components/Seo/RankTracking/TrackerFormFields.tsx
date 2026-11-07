/**
 * The fields of the tracker form. Nothing here asks again for what Settings already holds: the domain is
 * picked from Brand Tracking (the brand's own domains, then the competitors'), the market is the header
 * market, and the keywords are the Settings keywords of the market or of one keyword group. Extra keywords
 * (tracked here only, not in the AI-answer runs) stay behind a collapsed "Extra keywords" section.
 */
import type {
  RankDevices, RankSchedule, StoredRankKeywordScope
} from '../../../types/api/seoRankTracking';
import type { KeywordGroup } from '../../../types';
import { Disclosure } from '../../ui/Disclosure';
import { SettingsHint } from '../SettingsHint';
import {
  OTHER_DOMAIN, SCHEDULE_LABELS, inMarketText, type DomainOption
} from './rankTrackingFormat';

export interface TrackerDraft {
  /** The listed domain picked, or `OTHER_DOMAIN` for the free-text one. */
  domain: string;
  otherDomain: string;
  devices: RankDevices;
  depth: number;
  schedule: RankSchedule;
  keywordScope: StoredRankKeywordScope;
  groupId: string;
  keywordsText: string;
}

/** The defaults of a new tracker: every keyword of the market, mobile, top 30, weekly. */
export const DEFAULT_DRAFT: TrackerDraft = {
  domain: '',
  otherDomain: '',
  devices: 'mobile',
  depth: 30,
  schedule: 'weekly',
  keywordScope: 'all',
  groupId: '',
  keywordsText: '',
};

/** The domain the draft tracks (the typed one behind "Other domain"). */
export function draftDomain(draft: TrackerDraft): string {
  return (draft.domain === OTHER_DOMAIN ? draft.otherDomain : draft.domain).trim();
}

/** Whether the draft names a domain and, for the group scope, a group. */
export function isDraftComplete(draft: TrackerDraft): boolean {
  return draftDomain(draft) !== '' && (draft.keywordScope !== 'group' || draft.groupId !== '');
}

const DEPTHS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const DEVICE_OPTIONS: readonly {
  value: RankDevices;
  label: string 
}[] = [
  {
    value: 'mobile',
    label: 'Mobile only' 
  },
  {
    value: 'desktop',
    label: 'Desktop only' 
  },
  {
    value: 'both',
    label: 'Desktop + Mobile' 
  },
];
const SCHEDULE_OPTIONS: readonly { value: RankSchedule }[] = [
  { value: 'daily' }, { value: 'weekly' }, { value: 'monthly' }, { value: 'manual' },
];
const FIELD = 'mt-1 block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm';
const LABEL = 'block text-sm font-medium text-gray-700 dark:text-gray-200';

/** Distinct keyword lines (one keyword per line), trimmed and lower-cased like the server stores them. */
export function draftKeywords(text: string): string[] {
  return [...new Set(text.split(/\r?\n/).map((line) => line.trim().toLowerCase()).filter(Boolean))];
}

interface Choice {
  readonly value: string;
  readonly label: string;
}

function SelectField({
  label, value, choices, onSelect
}: {
  readonly label: string;
  readonly value: string;
  readonly choices: readonly Choice[];
  readonly onSelect: (value: string) => void 
}) {
  return (
    <label className={LABEL}>
      {label}
      <select className={FIELD} value={value} onChange={(event) => onSelect(event.target.value)}>
        {choices.map((choice) => (
          <option key={`${label}-${choice.value}`} value={choice.value}>{choice.label}</option>
        ))}
      </select>
    </label>
  );
}

const DEPTH_CHOICES: readonly Choice[] = DEPTHS.map((depth) => ({
  value: String(depth),
  label: `Top ${depth} results (${depth / 10} ${depth === 10 ? 'page' : 'pages'})`,
}));
const SCHEDULE_CHOICES: readonly Choice[] = Object.entries(SCHEDULE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

function pick<T extends string>(choices: readonly { value: T }[], value: string, fallback: T): T {
  return choices.find((choice) => choice.value === value)?.value ?? fallback;
}

type Setter = <K extends keyof TrackerDraft>(key: K, value: TrackerDraft[K]) => void;

function DomainField({
  draft, editing, domainOptions, hasOwnedDomain, set
}: {
  readonly draft: TrackerDraft;
  readonly editing: boolean;
  readonly domainOptions: readonly DomainOption[];
  readonly hasOwnedDomain: boolean;
  readonly set: Setter;
}) {
  if (editing) return <p className="text-sm text-gray-700 dark:text-gray-200">Domain: {draftDomain(draft)}</p>;
  const choices: Choice[] = [...domainOptions, {
    value: OTHER_DOMAIN,
    label: 'Other domain…',
  }];
  return (
    <div className="space-y-2">
      {!hasOwnedDomain && (
        <SettingsHint section="brand-config">Your website&apos;s domain is not set in Brand Tracking yet.</SettingsHint>
      )}
      {domainOptions.length > 0 && (
        <SelectField label="Domain" value={draft.domain} choices={choices} onSelect={(value) => set('domain', value)} />
      )}
      {draft.domain === OTHER_DOMAIN && (
        <label className={LABEL}>
          Other domain
          <input className={FIELD} value={draft.otherDomain} placeholder="example.com"
            onChange={(event) => set('otherDomain', event.target.value)} />
        </label>
      )}
    </div>
  );
}

function ScopeOption({
  value, checked, label, onSelect
}: {
  readonly value: StoredRankKeywordScope;
  readonly checked: boolean;
  readonly label: string;
  readonly onSelect: (value: StoredRankKeywordScope) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
      <input type="radio" name="rank-keyword-scope" value={value} checked={checked} onChange={() => onSelect(value)} />
      {label}
    </label>
  );
}

function KeywordScopeField({
  draft, marketLabel, groups, legacyList, set
}: {
  readonly draft: TrackerDraft;
  readonly marketLabel: string;
  readonly groups: readonly KeywordGroup[];
  readonly legacyList: boolean;
  readonly set: Setter;
}) {
  const groupChoices: Choice[] = [
    {
      value: '',
      label: 'Choose a group',
    },
    ...groups.map((group) => ({
      value: group.id,
      label: `${group.name} (${group.keyword_count})`,
    })),
  ];
  return (
    <fieldset className="space-y-2">
      <legend className={LABEL}>Keywords</legend>
      <ScopeOption value="all" checked={draft.keywordScope === 'all'} onSelect={(value) => set('keywordScope', value)}
        label={`All tracked keywords ${inMarketText(marketLabel)}`} />
      <ScopeOption value="group" checked={draft.keywordScope === 'group'} onSelect={(value) => set('keywordScope', value)}
        label="One keyword group" />
      {legacyList && (
        <ScopeOption value="list" checked={draft.keywordScope === 'list'} onSelect={(value) => set('keywordScope', value)}
          label="Only the extra keywords below" />
      )}
      {draft.keywordScope === 'group' && (
        <SelectField label="Keyword group" value={draft.groupId} choices={groupChoices} onSelect={(value) => set('groupId', value)} />
      )}
      <SettingsHint section="keywords">The keywords come from Settings: one added there is tracked from the next check.</SettingsHint>
    </fieldset>
  );
}

interface Props {
  readonly draft: TrackerDraft;
  readonly editing: boolean;
  /** The tracker was stored before keyword scopes and tracks its extra keywords only. */
  readonly legacyList: boolean;
  readonly marketLabel: string;
  readonly domainOptions: readonly DomainOption[];
  readonly hasOwnedDomain: boolean;
  readonly groups: readonly KeywordGroup[];
  readonly onChange: (draft: TrackerDraft) => void;
}

export function TrackerFormFields({
  draft, editing, legacyList, marketLabel, domainOptions, hasOwnedDomain, groups, onChange
}: Props) {
  const set: Setter = (key, value) => onChange({
    ...draft,
    [key]: value,
  });
  return (
    <div className="space-y-4">
      <DomainField draft={draft} editing={editing} domainOptions={domainOptions} hasOwnedDomain={hasOwnedDomain} set={set} />
      <p className="text-sm text-gray-600 dark:text-gray-300">{editing ? `Market: ${marketLabel}` : `Market: ${marketLabel} (the market chosen in the header)`}</p>
      <KeywordScopeField draft={draft} marketLabel={marketLabel} groups={groups} legacyList={legacyList} set={set} />
      <SelectField label="Devices" value={draft.devices} choices={DEVICE_OPTIONS}
        onSelect={(value) => set('devices', pick(DEVICE_OPTIONS, value, 'mobile'))} />
      {draft.devices === 'both' && (
        <p className="text-xs text-amber-700 dark:text-amber-400">Tracking both devices checks every keyword twice, once per device.</p>
      )}
      <SelectField label="Search depth" value={String(draft.depth)} choices={DEPTH_CHOICES}
        onSelect={(value) => set('depth', Number(value))} />
      <SelectField label="Schedule" value={draft.schedule} choices={SCHEDULE_CHOICES}
        onSelect={(value) => set('schedule', pick(SCHEDULE_OPTIONS, value, 'weekly'))} />
      <div>
        <Disclosure title="Extra keywords" headingLevel={3} headingClassName={LABEL}>
          <label className={LABEL}>
            {editing ? 'Extra keywords to add (one per line)' : 'Extra keywords (one per line)'}
            <textarea className={FIELD} rows={4} value={draft.keywordsText}
              onChange={(event) => set('keywordsText', event.target.value)} />
          </label>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Tracked for rankings only; they are not asked of the AI engines. Keywords you want everywhere belong in Settings.
          </p>
        </Disclosure>
      </div>
    </div>
  );
}
