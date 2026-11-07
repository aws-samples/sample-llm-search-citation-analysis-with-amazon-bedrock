/**
 * Business profile: one Google Business Profile, then its reviews, updates and Q&A on demand. The business starts
 * as the brand's Settings name and the point as the header market's city.
 */
import { useState } from 'react';
import type { LocalSeoProfile } from '../../../hooks/useLocalSeoProfile';
import type {
  BusinessIdentity, BusinessProfile, LocalPoint
} from '../../../types/api/seoLocal';
import { ErrorAlert } from '../../ui/ErrorAlert';
import { SkeletonLines } from '../../ui/Skeleton';
import {
  IdentityFields, PointFields
} from './LocalSeoFields';
import {
  LocalCard, LocalForm
} from './LocalSeoLayout';
import {
  EMPTY_POINT, pointFields
} from './localSeoRequest';
import {
  BrandNameHint, MarketPointHint, type LocalTabProps
} from './localSeoSettings';
import { ProfileActivity } from './ProfileActivity';

interface BusinessProfileTabProps extends LocalTabProps {readonly profile: LocalSeoProfile;}

function yesNo(value: boolean | null): string | null {
  if (value === null) return null;
  return value ? 'Yes' : 'No';
}

function ratingText(profile: BusinessProfile): string | null {
  return profile.rating === null ? null : `${String(profile.rating)} from ${String(profile.reviews_count ?? 0)} reviews`;
}

function ProfileFacts({ profile }: { readonly profile: BusinessProfile }) {
  const facts: [string, string | null][] = [
    ['Category', [profile.category, ...profile.additional_categories].filter(Boolean).join(', ') || null],
    ['Rating', ratingText(profile)],
    ['Address', profile.address],
    ['Phone', profile.phone],
    ['Website', profile.url],
    ['Claimed', yesNo(profile.is_claimed)],
    ['Now', profile.current_status],
    ['Photos', profile.total_photos === null ? null : String(profile.total_photos)],
    ['cid', profile.cid],
  ];
  return (
    <dl className="grid gap-2 sm:grid-cols-2 text-sm">
      {facts.filter(([, value]) => value !== null).map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs text-gray-500">{label}</dt>
          <dd className="text-gray-900 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Where the activity calls look: the profile's own coordinate, else the form's point. */
function activityPoint(profile: BusinessProfile, fallback: LocalPoint): LocalPoint {
  if (profile.latitude === null || profile.longitude === null) return fallback;
  return {
    ...fallback,
    latitude: profile.latitude,
    longitude: profile.longitude 
  };
}

/** The profile's cid when it has one (the most precise name for the activity calls). */
function activityIdentity(profile: BusinessProfile, asked: BusinessIdentity): BusinessIdentity {
  return profile.cid ? { cid: profile.cid } : asked;
}

export function BusinessProfileTab({
  profile, market, settings
}: BusinessProfileTabProps) {
  const [point, setPoint] = useState(EMPTY_POINT);
  const formPoint: LocalPoint = {
    ...market.marketField,
    ...pointFields(point) 
  };
  const {
    state, asked 
  } = profile;

  const found = state.status === 'success' ? state.response.profile : null;
  return (
    <div className="space-y-4">
      <LocalForm
        title="Business profile"
        submitLabel="Load profile"
        canSubmit={profile.identity.value.trim() !== '' && state.status !== 'loading'}
        onSubmit={() => { profile.load(profile.identity, formPoint); }}
        footer={<><BrandNameHint settings={settings} /><MarketPointHint market={market} /></>}
      >
        <IdentityFields identity={profile.identity} onChange={profile.setIdentity} />
        <PointFields point={point} onChange={setPoint} market={market} />
      </LocalForm>
      {state.status === 'loading' && <SkeletonLines lines={6} />}
      {state.status === 'error' && <ErrorAlert message={state.message} />}
      {state.status === 'success' && found === null && (
        <p className="text-sm text-gray-600">
          No Google Business Profile matched. Try the business&apos;s cid from the search or local results.
        </p>
      )}
      {state.status === 'success' && found !== null && asked !== null && (
        <>
          <LocalCard title={found.title} cached={state.response.cached}>
            <ProfileFacts profile={found} />
          </LocalCard>
          <ProfileActivity
            key={found.cid ?? found.title}
            identity={activityIdentity(found, asked)}
            point={activityPoint(found, formPoint)}
          />
        </>
      )}
    </div>
  );
}
