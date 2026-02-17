export type S3ItemType = 'folder' | 'file' | 'image';

export interface S3Item {
  name: string;
  path: string;
  type: S3ItemType;
  size?: number;
  last_modified?: string;
}

export interface S3BrowseResponse {
  prefix: string;
  folders: S3Item[];
  files: S3Item[];
  total_folders: number;
  total_files: number;
}

export interface RawResponseDocument {
  keyword: string;
  provider: string;
  timestamp: string;
  raw_api_response: Record<string, unknown>;
  extracted: {
    response_text: string;
    citations: string[];
    brands: Array<{
      name: string;
      rank: number;
      mention_count: number;
    }>;
  };
  metadata: {
    model: string;
    latency_ms: number;
    usage?: Record<string, unknown>;
  };
}

export interface RawResponseContent {
  key: string;
  content: RawResponseDocument | string;
  content_type: string;
  size: number;
  last_modified: string;
  is_json: boolean;
}
