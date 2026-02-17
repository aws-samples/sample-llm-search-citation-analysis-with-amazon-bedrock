export type ContentIdeaType = 'visibility_gap' | 'ranking_improvement' | 'provider_gap' | 'configuration' | 'data';
export type ContentPriority = 'high' | 'medium' | 'low';
export type ContentAngle = 'comprehensive_guide' | 'differentiation' | 'provider_optimization';
export type ContentStatus = 'pending' | 'generating' | 'generated' | 'failed';

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
}

export interface GeneratedContent {
  title: string;
  meta_description: string;
  body: string;
  suggested_headings: string[];
  key_points: string[];
}

export interface ContentStudioHistory {
  id: string;
  keyword: string;
  idea_type: string;
  idea_title: string;
  content_angle: string;
  generated_content: GeneratedContent;
  raw_content: string;
  competitor_sources_used: number;
  status: ContentStatus;
  viewed: boolean;
  error_message?: string;
  created_at: string;
  updated_at: string;
}
