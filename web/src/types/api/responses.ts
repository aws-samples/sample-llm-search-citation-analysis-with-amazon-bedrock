type S3ItemType = 'folder' | 'file' | 'image';

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
  /** Continues a folder of more than one page (1,000 entries, newest first); `null` on the last page. */
  next_token?: string | null;
  /** Folders and files in the whole folder, not just this page (as far as it was read, see `truncated`). */
  folder_count?: number;
  file_count?: number;
  /** The folder was too big to read in full, so its newest entries may be missing from the listing. */
  truncated?: boolean;
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
  /** `null` when the object is too large to send inline (`too_large`). */
  content: RawResponseDocument | string | null;
  content_type: string;
  size: number;
  last_modified: string;
  is_json: boolean;
  /** Over the API's inline limit (1 MB): download the file instead of previewing it. */
  too_large?: boolean;
  max_inline_bytes?: number;
}
