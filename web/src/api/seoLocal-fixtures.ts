/** Builders of local SEO API answers (fictional businesses only). */
import type {
  BusinessListing,
  BusinessProfile,
  BusinessSearchResponse,
  GridPoint,
  GridResult,
  LocalJob,
  LocalResultItem,
  LocalSerpResponse,
  ProfileResponse,
  QuestionsResponse,
  ReviewsResult,
  StartJobResponse,
} from '../types/api/seoLocal';

const FETCHED_AT = '2026-10-02T08:00:00Z';
const PAID = {
  cached: false,
  fetched_at: FETCHED_AT 
};

export function buildListing(overrides: Partial<BusinessListing> = {}): BusinessListing {
  return {
    title: 'Acme Cafe',
    category: 'Coffee shop',
    additional_categories: [],
    address: '1 Example St',
    phone: '+1 555 0100',
    url: 'https://acme.example.org/',
    domain: 'acme.example.org',
    rating: 4.6,
    reviews_count: 120,
    is_claimed: true,
    cid: '1234567890',
    place_id: 'ChIJexample-cafe',
    latitude: 40,
    longitude: -74,
    total_photos: 30,
    description: null,
    check_url: null,
    ...overrides,
  };
}

export function buildSearchResponse(businesses: BusinessListing[] = [buildListing()]): BusinessSearchResponse {
  return {
    ...PAID,
    businesses,
    center: {
      latitude: 40,
      longitude: -74,
      radius_km: 10 
    } 
  };
}

export function buildProfile(overrides: Partial<BusinessProfile> = {}): BusinessProfile {
  const {
    description, check_url: checkUrl, ...business 
  } = buildListing();
  return {
    ...business,
    description,
    check_url: checkUrl,
    rating_distribution: {
      '1': 2,
      '2': 1,
      '3': 5,
      '4': 20,
      '5': 92 
    },
    current_status: 'open',
    timetable: { monday: ['09:00-17:00'] },
    ...overrides,
  };
}

export function buildProfileResponse(profile: BusinessProfile | null = buildProfile()): ProfileResponse {
  return {
    ...PAID,
    profile 
  };
}

export function buildQuestionsResponse(questions: QuestionsResponse['questions'] = []): QuestionsResponse {
  return {
    ...PAID,
    questions 
  };
}

export function buildResultItem(rank: number, overrides: Partial<LocalResultItem> = {}): LocalResultItem {
  return {
    ...buildListing({
      title: `Business ${String(rank)}`,
      cid: String(rank) 
    }),
    rank_group: rank,
    rank_absolute: rank,
    ...overrides 
  };
}

export function buildLocalSerpResponse(overrides: Partial<LocalSerpResponse> = {}): LocalSerpResponse {
  return {
    ...PAID,
    keyword: 'coffee',
    search_type: 'maps',
    items: [buildResultItem(1), buildResultItem(2, {
      title: 'Acme Cafe',
      cid: '1234567890' 
    })],
    match: {
      index: 1,
      rank: 2,
      title: 'Acme Cafe',
      cid: '1234567890',
      place_id: null 
    },
    check_url: null,
    ...overrides,
  };
}

export function buildReviewsResult(): ReviewsResult {
  return {
    totals: {
      title: 'Acme Cafe',
      reviews_count: 120,
      rating: 4.6,
      cid: '1234567890',
      place_id: null 
    },
    reviews: [{
      review_id: 'r-1',
      rating: 5,
      timestamp: null,
      time_ago: '2 weeks ago',
      review_text: 'Good coffee',
      profile_name: 'A. Reviewer',
      local_guide: false,
      owner_answer: 'Thanks!',
      owner_timestamp: null,
    }],
    summary: {
      histogram: {
        '1': 0,
        '2': 0,
        '3': 0,
        '4': 0,
        '5': 1 
      },
      owner_response_rate: 1 
    },
  };
}

export function buildGridPoint(index: number, rank: number | null, status: GridPoint['status'] = 'ready'): GridPoint {
  return {
    index,
    row: Math.floor(index / 3),
    col: index % 3,
    latitude: 40,
    longitude: -74,
    status,
    rank,
    results_count: 20,
    top_result: {
      title: 'Business 1',
      cid: '1' 
    },
  };
}

export function buildGridResult(ranks: (number | null)[] = [1, 4, 15, null, 2, 3, 8, null, 11]): GridResult {
  return {
    points: ranks.map((rank, index) => buildGridPoint(index, rank)),
    summary: {
      points_total: 9,
      points_searched: 9,
      points_failed: 0,
      points_found: 7,
      average_rank: 6.29,
      top3_count: 3,
      top10_count: 5,
    },
  };
}

const JOB_BASE = {
  job_id: '0123456789abcdef0123456789abcdef',
  created_at: FETCHED_AT,
  updated_at: FETCHED_AT,
  error_code: null,
  error: null,
};

export function buildGridJob(status: LocalJob['status'] = 'completed', result: GridResult | null = buildGridResult()): LocalJob {
  return {
    ...JOB_BASE,
    kind: 'grid',
    status,
    progress: {
      ready: status === 'completed' ? 9 : 0,
      total: 9 
    },
    result 
  };
}

export function buildReviewsJob(status: LocalJob['status'] = 'completed'): LocalJob {
  return {
    ...JOB_BASE,
    kind: 'reviews',
    status,
    progress: {
      ready: status === 'completed' ? 1 : 0,
      total: 1 
    },
    result: status === 'completed' ? buildReviewsResult() : null,
  };
}

export function buildStartJobResponse(job: LocalJob = buildGridJob(), reused = false): StartJobResponse {
  return {
    job_id: job.job_id,
    reused,
    job 
  };
}
