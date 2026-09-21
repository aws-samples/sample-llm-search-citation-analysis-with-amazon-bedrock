export type ContentIdeaType =
  | 'visibility_gap'
  | 'ranking_improvement'
  | 'provider_gap'
  | 'configuration'
  | 'data'
  | 'self_reflection'
  | 'seasonal_content'
  | 'trending_topic'
  | 'evergreen_content'
  | 'citation_opportunity'
  | 'leadership_maintenance'
  | 'sentiment_improvement'
  | 'group_brief';
export type ContentPriority = 'high' | 'medium' | 'low';
export type GroupBriefMode =
  | 'improve_current_url'
  | 'rewrite_pasted_copy'
  | 'create_new_landing_page';
export type ContentAngle =
  | 'comprehensive_guide'
  | 'differentiation'
  | 'provider_optimization'
  | 'thought_leadership'
  | 'reputation_management'
  | 'seasonal'
  | 'trending'
  | 'evergreen'
  | GroupBriefMode;
export type ContentStatus = 'pending' | 'generating' | 'generated' | 'failed';
export type ContentBriefBatchStatus = ContentStatus | 'missing';
export type ContentBriefStrategy = 'combined' | 'per_keyword';

export type ContentBriefScope =
  | {
    mode: 'groups';
    group_ids: string[];
  }
  | {
    mode: 'keywords';
    keyword_ids: string[];
  };

export interface ContentIdea {
  id: string;
  type: ContentIdeaType;
  priority: ContentPriority;
  title: string;
  description: string;
  keyword: string | null;
  source: string;
  competitor_brands?: string[];
  competitor_urls?: string[];
  providers_missing?: string[];
  providers_present?: string[];
  current_rank?: number;
  actionable: boolean;
  content_angle?: ContentAngle;
  persona_name?: string;
  seasonal_theme?: string;
  trending_topic?: string;
  output_language?: string;
}

export interface ContentBriefFields {
  content_angle: GroupBriefMode;
  landing_url: string;
  current_copy: string;
  template_id: string;
  prompt_template: string;
  output_language: string;
}

/** Minimal authoritative payload accepted by POST /content-studio/generate. */
export interface GroupBriefIdea extends ContentBriefFields {
  id: string;
  type: 'group_brief';
  scope: ContentBriefScope;
}

export type ContentGenerationIdea = ContentIdea | GroupBriefIdea;

/** One canonical brief expanded server-side into one child per resolved keyword. */
export interface ContentBriefBatchRequest {
  batch_id: string;
  scope: ContentBriefScope;
  brief: ContentBriefFields;
}

export interface GenerateContentResponse {
  success: boolean;
  id: string;
  status: ContentStatus;
  keyword: string;
  message?: string;
  error?: string;
  idempotent_hit?: boolean;
}

export interface ContentBriefBatchStartChild {
  id: string;
  idea_id: string;
  keyword_id: string;
  keyword: string;
  status: ContentStatus;
  batch_position: number;
  idempotent_hit: boolean;
}

export interface ContentBriefBatchStartResponse {
  success: boolean;
  batch_id: string;
  batch_size: number;
  accepted_count: number;
  existing_count: number;
  failed_count: number;
  children: ContentBriefBatchStartChild[];
  error?: string;
}

export interface ContentBriefBatchCounts {
  pending: number;
  generating: number;
  generated: number;
  failed: number;
  missing: number;
  total: number;
}

export interface ContentBriefBatchStatusChild {
  id: string;
  idea_id: string;
  keyword_id: string;
  keyword: string;
  status: ContentBriefBatchStatus;
  batch_position: number;
  created_at: string | null;
  updated_at: string | null;
  has_content: boolean;
  error_message: string | null;
}

export interface ContentBriefBatchStatusResponse {
  batch_id: string;
  batch_size: number;
  children: ContentBriefBatchStatusChild[];
  counts: ContentBriefBatchCounts;
}

export interface ContentBriefTemplate {
  id: string;
  name: string;
  description: string;
  content_angle: GroupBriefMode;
  prompt_template: string;
  builtin: boolean;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ContentBriefTemplateDraft {
  name: string;
  description: string;
  contentAngle: GroupBriefMode;
  promptTemplate: string;
}

export type ContentBriefTemplateChanges = Partial<ContentBriefTemplateDraft>;

export interface GeneratedContent {
  title: string;
  meta_description: string;
  body: string;
  suggested_headings: string[];
  key_points: string[];
}

export interface ContentWarning {
  code: 'incomplete_metadata';
  message: string;
  missing_fields: string[];
}

export interface ContentStudioHistory {
  id: string;
  keyword: string;
  idea_title: string;
  content_angle: string;
  generated_content?: GeneratedContent;
  content_warning?: ContentWarning;
  competitor_sources_used: number;
  status: ContentStatus;
  viewed: boolean;
  error_message?: string;
  created_at: string;
  updated_at: string;
  batch_id?: string;
  batch_size?: number;
  batch_position?: number;
  keyword_id?: string;
}
