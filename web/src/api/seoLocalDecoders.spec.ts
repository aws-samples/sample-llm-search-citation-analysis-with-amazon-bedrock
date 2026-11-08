import {
  describe, expect, it
} from 'vitest';
import {
  isBusinessSearchResponse, isLocalJob, isLocalSerpResponse, isProfileResponse, isStartJobResponse
} from './seoLocalDecoders';
import {
  buildGridJob, buildListing, buildLocalSerpResponse, buildProfile, buildProfileResponse, buildReviewsJob,
  buildSearchResponse, buildStartJobResponse
} from './seoLocal-fixtures';
import { withoutField } from './seo-fixtures';

describe('isBusinessSearchResponse', () => {
  it('accepts a search answer with listings', () => {
    expect(isBusinessSearchResponse(buildSearchResponse())).toBe(true);
  });

  it('rejects a listing whose rating is text', () => {
    const answer = {
      ...buildSearchResponse(),
      businesses: [{
        ...buildListing(),
        rating: '4.6' 
      }] 
    };

    expect(isBusinessSearchResponse(answer)).toBe(false);
  });

  it('rejects an answer without its fetch time', () => {
    const answer = withoutField(buildSearchResponse(), 'fetched_at');

    expect(isBusinessSearchResponse(answer)).toBe(false);
  });
});

describe('isProfileResponse', () => {
  it('accepts a null profile when none matched', () => {
    expect(isProfileResponse(buildProfileResponse(null))).toBe(true);
  });

  it('rejects a profile whose rating distribution misses a star', () => {
    const profile = {
      ...buildProfile(),
      rating_distribution: {
        '1': 0,
        '2': 0,
        '3': 0,
        '4': 0 
      } 
    };

    expect(isProfileResponse({
      ...buildProfileResponse(),
      profile 
    })).toBe(false);
  });
});

describe('isLocalSerpResponse', () => {
  it('accepts results without a match', () => {
    expect(isLocalSerpResponse(buildLocalSerpResponse({ match: null }))).toBe(true);
  });

  it('rejects an unknown search type', () => {
    expect(isLocalSerpResponse({
      ...buildLocalSerpResponse(),
      search_type: 'organic' 
    })).toBe(false);
  });
});

describe('isLocalJob', () => {
  it('accepts a completed grid job', () => {
    expect(isLocalJob(buildGridJob())).toBe(true);
  });

  it('accepts a reviews job still collecting without a result', () => {
    expect(isLocalJob(buildReviewsJob('collecting'))).toBe(true);
  });

  it('rejects a grid job carrying a reviews result', () => {
    expect(isLocalJob({
      ...buildGridJob(),
      result: buildReviewsJob().result 
    })).toBe(false);
  });

  it('rejects an unknown job status', () => {
    expect(isLocalJob({
      ...buildGridJob(),
      status: 'paused' 
    })).toBe(false);
  });
});

describe('isStartJobResponse', () => {
  it('accepts a reused job', () => {
    expect(isStartJobResponse(buildStartJobResponse(buildGridJob(), true))).toBe(true);
  });
});
