import type {
  RawResponseContent, S3Item
} from '../../types';

export function buildFile(overrides: Partial<S3Item> = {}): S3Item {
  return {
    name: 'test-file.json',
    path: 'responses/test-file.json',
    type: 'file',
    size: 1024,
    last_modified: '2024-01-15T10:30:00Z',
    ...overrides,
  };
}

export function buildContent(overrides: Partial<RawResponseContent> = {}): RawResponseContent {
  return {
    key: 'responses/test-file.json',
    content: 'test content',
    content_type: 'application/json',
    size: 1024,
    last_modified: '2024-01-15T10:30:00Z',
    is_json: true,
    ...overrides,
  };
}

export function buildDocumentContent(): RawResponseContent {
  return {
    key: 'responses/test-file.json',
    content: {
      provider: 'openai',
      keyword: 'test keyword',
      timestamp: '2024-01-15T10:30:00Z',
      raw_api_response: {},
      extracted: {
        response_text: 'AI response text',
        citations: ['https://example.com'],
        brands: [],
      },
      metadata: {
        model: 'gpt-4',
        latency_ms: 150
      },
    },
    content_type: 'application/json',
    size: 2048,
    last_modified: '2024-01-15T10:30:00Z',
    is_json: true,
  };
}
