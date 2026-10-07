/**
 * The written narrative of a keyword group's run (`narrative` of
 * `GET /reports/insights`), stored by the GenerateInsights step
 * (`lambda/report-insights`). Every item survived
 * `shared.insights_narrative.validate_narrative`: it cites computed insights
 * by id and states only numbers found in their evidence or the group's KPIs.
 */

/** One written insight, with the ids of the computed insights it rests on. */
export interface NarrativeInsight {
  text: string;
  insight_ids: string[];
}

/** One recommended action, with the ids of the computed insights it rests on. */
export interface NarrativeRecommendation extends NarrativeInsight {title: string;}

export interface InsightsNarrative {
  /** The run the narrative was written for. */
  run_timestamp: string;
  /** The Bedrock model that wrote it. */
  model: string | null;
  generated_at: string | null;
  /** ISO 639-1 code of the group's keyword language, which the narrative is written in. */
  language: string;
  /** At most three. */
  insights: NarrativeInsight[];
  /** At most six. */
  recommendations: NarrativeRecommendation[];
  /** Items the validator removed: an unknown insight id or a number not in the facts. */
  dropped: number;
}
