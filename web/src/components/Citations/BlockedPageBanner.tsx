import { StrokeIcon } from '../ui/StrokeIcon';
import { WARNING_PATHS } from '../ui/iconPaths';
import type { BlockReason } from '../../types';

export const BLOCK_REASON_LABELS: Record<BlockReason, string> = {
  captcha: 'CAPTCHA verification required',
  access_denied: 'Access denied (403 Forbidden)',
  rate_limited: 'Rate limited - too many requests',
  geo_blocked: 'Region-restricted content',
  login_required: 'Login required to access content',
};

/** Narrows the free-form `block_reason` the crawler records to a known label key. */
export function isBlockReason(value: string | undefined): value is BlockReason {
  const validReasons = ['captcha', 'access_denied', 'rate_limited', 'geo_blocked', 'login_required'];
  return value !== undefined && validReasons.includes(value);
}

interface BlockedPageBannerProps {readonly blockReason?: BlockReason;}

/** Warns that a crawl captured a bot-detection page rather than the cited content. */
export const BlockedPageBanner = ({ blockReason }: BlockedPageBannerProps) => (
  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
    <div className="flex items-start gap-3">
      <StrokeIcon className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" paths={WARNING_PATHS} strokeWidth={2} />
      <div>
        <h4 className="text-sm font-semibold text-amber-800">Bot Detection Blocked</h4>
        <p className="text-sm text-amber-700 mt-1">
          This site blocked automated access. The screenshot shows the block page, not the actual content.
        </p>
        {blockReason && (
          <p className="text-sm text-amber-600 mt-2">
            <span className="font-medium">Reason:</span> {BLOCK_REASON_LABELS[blockReason]}
          </p>
        )}
      </div>
    </div>
  </div>
);
