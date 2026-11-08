/**
 * Local SEO client: the `/seo/local/...` routes of the SEO API (`lambda/seo/seo-local.py`).
 *
 * Every paid route (businesses, profile, questions, serp, jobs) runs only on an explicit user action and is
 * never retried here: a timed-out paid call may already be billed. Categories and job status are free.
 */
import {
  seoGet, seoPost, type SeoRequestOptions
} from './seoRequest';
import { decodeSeo } from './seoDecoders';
import {
  isBusinessSearchResponse,
  isCategoriesResponse,
  isLocalJob,
  isLocalSerpResponse,
  isProfileResponse,
  isQuestionsResponse,
  isStartJobResponse,
} from './seoLocalDecoders';
import type {
  BusinessSearchRequest,
  BusinessSearchResponse,
  CategoriesResponse,
  LocalJob,
  LocalJobRequest,
  LocalSerpRequest,
  LocalSerpResponse,
  LocalTarget,
  ProfileRequest,
  ProfileResponse,
  QuestionsResponse,
  StartJobResponse,
} from '../types/api/seoLocal';

export async function fetchBusinessCategories(query: string, options: SeoRequestOptions = {}): Promise<CategoriesResponse> {
  return decodeSeo(await seoGet('/local/categories', {
    query,
    limit: '50' 
  }, options), isCategoriesResponse, 'category list');
}

export async function searchBusinesses(
  request: BusinessSearchRequest, options: SeoRequestOptions = {}
): Promise<BusinessSearchResponse> {
  return decodeSeo(await seoPost('/local/businesses', request, options), isBusinessSearchResponse, 'business search');
}

export async function fetchBusinessProfile(request: ProfileRequest, options: SeoRequestOptions = {}): Promise<ProfileResponse> {
  return decodeSeo(await seoPost('/local/profile', request, options), isProfileResponse, 'business profile');
}

export async function fetchBusinessQuestions(
  request: ProfileRequest, options: SeoRequestOptions = {}
): Promise<QuestionsResponse> {
  return decodeSeo(await seoPost('/local/questions', request, options), isQuestionsResponse, 'questions and answers');
}

export async function fetchLocalSerp(request: LocalSerpRequest, options: SeoRequestOptions = {}): Promise<LocalSerpResponse> {
  return decodeSeo(await seoPost('/local/serp', request, options), isLocalSerpResponse, 'local results');
}

export async function startLocalJob(request: LocalJobRequest, options: SeoRequestOptions = {}): Promise<StartJobResponse> {
  return decodeSeo(await seoPost('/local/jobs', request, options), isStartJobResponse, 'job');
}

/** Free: the job's status and results; a grid is ranked for `target` when one is given. */
export async function fetchLocalJob(
  jobId: string, target: LocalTarget = {}, options: SeoRequestOptions = {}
): Promise<LocalJob> {
  return decodeSeo(await seoGet(`/local/jobs/${encodeURIComponent(jobId)}`, { ...target }, options), isLocalJob, 'job');
}
