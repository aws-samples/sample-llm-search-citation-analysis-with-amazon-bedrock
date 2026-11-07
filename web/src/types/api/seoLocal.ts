/**
 * Local SEO API (`${SEO_API_BASE_URL}/seo/local/...`, `lambda/seo/seo-local.py`): business listings,
 * Google Business Profiles, Maps / Local Finder results and the queued jobs (reviews, updates, rank grids).
 * Field names are the API's (snake_case).
 */

/** The fields every business row carries (a listing, a profile, a Maps result). */
export interface LocalBusiness {
  title: string;
  category: string | null;
  additional_categories: string[];
  address: string | null;
  phone: string | null;
  url: string | null;
  domain: string | null;
  rating: number | null;
  reviews_count: number | null;
  is_claimed: boolean | null;
  cid: string | null;
  place_id: string | null;
  latitude: number | null;
  longitude: number | null;
  total_photos: number | null;
}

export interface BusinessListing extends LocalBusiness {
  description: string | null;
  check_url: string | null;
}

/** Review counts per star, `"1"` to `"5"`. */
export type StarCounts = Record<'1' | '2' | '3' | '4' | '5', number>;

export interface BusinessProfile extends LocalBusiness {
  description: string | null;
  rating_distribution: StarCounts;
  current_status: string | null;
  /** Opening ranges per weekday (`"09:00-17:00"`); an empty list is a closed day. */
  timetable: Record<string, string[]>;
  check_url: string | null;
}

export interface LocalResultItem extends LocalBusiness {
  rank_group: number | null;
  rank_absolute: number | null;
}

/** The cache flag and fetch time of a paid answer. */
export interface PaidAnswer {
  cached: boolean;
  fetched_at: string;
}

/** Exactly one way to name a business. */
export type BusinessIdentity = { name: string } | { cid: string } | { place_id: string };

/** A coordinate; without one the route uses the market's city coordinates. */
export interface LocalPoint {
  latitude?: number;
  longitude?: number;
  market_id?: string;
}

export interface CategoriesResponse {
  categories: {
    category: string;
    business_count: number | null 
  }[];
  total: number;
}

export type ListingsSort = 'relevance' | 'rating' | 'reviews';

export interface BusinessSearchRequest extends LocalPoint {
  query?: string;
  categories?: string[];
  radius_km?: number;
  is_claimed?: boolean;
  sort_by?: ListingsSort;
  limit?: number;
}

export interface BusinessSearchResponse extends PaidAnswer {
  businesses: BusinessListing[];
  center: {
    latitude: number;
    longitude: number;
    radius_km: number 
  } | null;
}

export type ProfileRequest = BusinessIdentity & LocalPoint;

export interface ProfileResponse extends PaidAnswer {profile: BusinessProfile | null;}

export interface QuestionAnswer {
  answer_text: string;
  profile_name: string | null;
  time_ago: string | null;
  timestamp: string | null;
}

export interface BusinessQuestion {
  question_id: string | null;
  question_text: string;
  profile_name: string | null;
  time_ago: string | null;
  timestamp: string | null;
  answers: QuestionAnswer[];
}

export interface QuestionsResponse extends PaidAnswer {questions: BusinessQuestion[];}

export type LocalSearchType = 'maps' | 'local_finder';
export type LocalDevice = 'mobile' | 'desktop';

/** The business to find in results: any of these, or (none given) the brand's own domains. */
export interface LocalTarget {
  cid?: string;
  place_id?: string;
  domain?: string;
  name?: string;
}

export interface LocalSerpRequest extends LocalPoint, LocalTarget {
  keyword: string;
  search_type?: LocalSearchType;
  device?: LocalDevice;
  depth?: number;
}

export interface LocalMatch {
  index: number;
  rank: number | null;
  title: string | null;
  cid: string | null;
  place_id: string | null;
}

export interface LocalSerpResponse extends PaidAnswer {
  keyword: string;
  search_type: LocalSearchType;
  items: LocalResultItem[];
  match: LocalMatch | null;
  check_url: string | null;
}

export type LocalJobStatus = 'queued' | 'collecting' | 'completed' | 'failed' | 'timed_out';
export type GridSize = 3 | 5 | 7;
export type ReviewSort = 'newest' | 'highest_rating' | 'lowest_rating' | 'relevant';

export type ReviewsJobRequest = BusinessIdentity & LocalPoint & {
  kind: 'reviews';
  depth?: number;
  sort_by?: ReviewSort 
};
export type UpdatesJobRequest = BusinessIdentity & LocalPoint & {
  kind: 'updates';
  depth?: number 
};
export interface GridJobRequest extends LocalPoint, LocalTarget {
  kind: 'grid';
  keyword: string;
  grid_size: GridSize;
  spacing_km: number;
  device?: LocalDevice;
}
export type LocalJobRequest = ReviewsJobRequest | UpdatesJobRequest | GridJobRequest;

export interface BusinessReview {
  review_id: string | null;
  rating: number | null;
  timestamp: string | null;
  time_ago: string | null;
  review_text: string | null;
  profile_name: string | null;
  local_guide: boolean;
  owner_answer: string | null;
  owner_timestamp: string | null;
}

export interface ReviewsResult {
  totals: {
    title: string | null;
    reviews_count: number | null;
    rating: number | null;
    cid: string | null;
    place_id: string | null 
  };
  reviews: BusinessReview[];
  summary: {
    histogram: StarCounts;
    owner_response_rate: number | null 
  };
}

export interface BusinessUpdate {
  author: string | null;
  post_date: string | null;
  timestamp: string | null;
  post_text: string | null;
  url: string | null;
  links: {
    title: string | null;
    url: string | null 
  }[];
}

export interface UpdatesResult {updates: BusinessUpdate[];}

export type GridPointStatus = 'ready' | 'pending' | 'failed';

export interface GridPoint {
  index: number;
  row: number;
  col: number;
  latitude: number;
  longitude: number;
  status: GridPointStatus;
  rank: number | null;
  results_count: number | null;
  top_result: {
    title: string | null;
    cid: string | null 
  } | null;
}

export interface GridSummary {
  points_total: number;
  points_searched: number;
  points_failed: number;
  points_found: number;
  average_rank: number | null;
  top3_count: number;
  top10_count: number;
}

export interface GridResult {
  points: GridPoint[];
  summary: GridSummary;
}

interface LocalJobBase {
  job_id: string;
  status: LocalJobStatus;
  created_at: string;
  updated_at: string;
  progress: {
    ready: number;
    total: number 
  };
  error_code: string | null;
  error: string | null;
}

export type LocalJob =
  | (LocalJobBase & {
    kind: 'reviews';
    result: ReviewsResult | null 
  })
  | (LocalJobBase & {
    kind: 'updates';
    result: UpdatesResult | null 
  })
  | (LocalJobBase & {
    kind: 'grid';
    result: GridResult | null 
  });

export interface StartJobResponse {
  job_id: string;
  /** An equal request within the hour: its tasks are collected again, never bought twice. */
  reused: boolean;
  job: LocalJob;
}
