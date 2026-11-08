/**
 * "Measure a page": the URL starts from the homepage of the brand's own domain (Settings › Brand Tracking) and
 * suggests the latest audit's pages. Nothing is measured until Run Lighthouse is pressed (one paid run).
 */
import {
  useId, useState, type SubmitEvent
} from 'react';
import { usePrefilledText } from '../../../hooks/usePrefilledText';
import { useBrandSettings } from '../../../hooks/useSeoSettings';
import type { LighthouseDevice } from '../../../types/api/seoPerformance';
import { Button } from '../../ui/Button';
import { SettingsHint } from '../SettingsHint';
import { ownedHomepage } from './ownedPages';

interface MeasurePageFormProps {
  /** Page URLs offered while typing. */
  readonly suggestions: readonly string[];
  /** Called when the URL field is first focused, to read more suggestions. */
  readonly onWantSuggestions: () => void;
  readonly busy: boolean;
  readonly onMeasure: (url: string, device: LighthouseDevice) => void;
}

export function MeasurePageForm({
  suggestions, onWantSuggestions, busy, onMeasure
}: MeasurePageFormProps) {
  const brand = useBrandSettings();
  const homepage = ownedHomepage(brand.data.ownedDomains);
  const [url, setUrl] = usePrefilledText(homepage);
  const [device, setDevice] = useState<LighthouseDevice>('mobile');
  const listId = useId();

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    onMeasure(url.trim(), device);
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 space-y-3" aria-label="Measure a page">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-gray-900">Measure a page</h3>
        <p className="text-xs text-gray-500">Your own domains only</p>
      </div>
      <form className="grid gap-3 sm:grid-cols-4" onSubmit={submit}>
        <label className="text-sm text-gray-700 sm:col-span-2">
          Page URL
          <input
            className="mt-1 block w-full rounded-sm border border-gray-300 px-2 py-1"
            value={url}
            list={listId}
            onFocus={onWantSuggestions}
            onChange={(event) => { setUrl(event.target.value); }}
            placeholder="https://www.example.com/"
          />
          <datalist id={listId}>
            {suggestions.map((page) => <option key={page} value={page} />)}
          </datalist>
        </label>
        <label className="text-sm text-gray-700">
          Device
          <select
            className="mt-1 block w-full rounded-sm border border-gray-300 px-2 py-1"
            value={device}
            onChange={(event) => { setDevice(event.target.value === 'desktop' ? 'desktop' : 'mobile'); }}
          >
            <option value="mobile">Mobile</option>
            <option value="desktop">Desktop</option>
          </select>
        </label>
        <div className="flex items-end">
          <Button type="submit" disabled={url.trim() === '' || busy}>Run Lighthouse</Button>
        </div>
      </form>
      {brand.loaded && homepage === '' && (
        <SettingsHint section="brand-config">Add the brand&apos;s own domain and this field starts from its homepage.</SettingsHint>
      )}
    </section>
  );
}
