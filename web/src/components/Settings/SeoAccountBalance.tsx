import { useSeoAccount } from '../../hooks/useSeoAccount';
import { Skeleton } from '../ui/Skeleton';

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

interface Props {
  /** Re-read when the stored key changes (its masked form). */
  readonly refreshKey: string | null;
}

/**
 * The DataForSEO account balance on its card, read on demand from the free
 * `GET /api/seo/account`. Mounted only for an administrator; shows nothing
 * when the SEO stack is not deployed or no login is stored.
 */
export function SeoAccountBalance({ refreshKey }: Props) {
  const {
    account, loading, error
  } = useSeoAccount(true, refreshKey);

  if (loading) return <Skeleton className="h-6 w-28 rounded-sm" />;
  if (error !== null) return <span className="text-xs text-gray-500">Balance unavailable</span>;
  if (!account?.configured) return null;
  return (
    <span className="text-xs text-gray-700 bg-gray-100 px-2 py-1 rounded-sm">
      {account.balance_usd === null ? 'Balance unavailable' : `Balance ${USD.format(account.balance_usd)}`}
    </span>
  );
}
