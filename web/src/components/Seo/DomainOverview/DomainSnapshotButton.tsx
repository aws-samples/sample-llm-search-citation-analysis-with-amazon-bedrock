import { useState } from 'react';
import { seoErrorMessage } from '../../../api/seo';
import { takeDomainSnapshot } from '../../../api/seoDomains';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';

interface Props {
  readonly domain: string;
  readonly marketId: string;
}

type Outcome = { readonly kind: 'idle' | 'sending' } | {
  readonly kind: 'done' | 'failed';
  readonly message: string;
};

/**
 * (Admin) Store an estimated traffic snapshot of the domain now, after a
 * confirmation naming its paid calls; the weekly sweep snapshots your and your
 * competitors' domains on its own.
 */
export function DomainSnapshotButton({
  domain, marketId
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const confirm = async () => {
    setConfirming(false);
    setOutcome({ kind: 'sending' });
    try {
      await takeDomainSnapshot({
        domain,
        market_id: marketId,
      });
      setOutcome({
        kind: 'done',
        message: 'Snapshot started; it appears in the SEO vs GEO report in a few minutes.',
      });
    } catch (failure) {
      setOutcome({
        kind: 'failed',
        message: seoErrorMessage(failure),
      });
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" size="sm" disabled={outcome.kind === 'sending'} onClick={() => setConfirming(true)}>
        Snapshot estimated traffic now
      </Button>
      {(outcome.kind === 'done' || outcome.kind === 'failed') && (
        <output className={`text-sm ${outcome.kind === 'failed' ? 'text-red-700' : 'text-gray-600'}`}>{outcome.message}</output>
      )}
      <Modal isOpen={confirming} onClose={() => setConfirming(false)} title="Snapshot estimated traffic">
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            {`Stores ${domain}'s estimated organic traffic and its top 1,000 ranked keywords in this market. `}
            {'This starts 2 paid DataForSEO calls. At most one manual snapshot per domain and market per hour. Continue?'}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirming(false)}>Cancel</Button>
            <Button onClick={() => { void confirm(); }}>Take snapshot</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
