/**
 * Query prompt template for persona-based searches.
 */
export interface QueryPrompt {
  id: string;
  name: string;
  template: string;
  enabled: string; // "true" or "false" (DynamoDB GSI compat)
  created_at: string;
  updated_at: string;
}
