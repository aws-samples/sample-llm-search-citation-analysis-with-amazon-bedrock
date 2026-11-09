/** Display label of a brand's classification. */
export const classificationLabel = (classification: string): string => {
  switch (classification) {
    case 'first_party':
      return 'First Party';
    case 'competitor':
      return 'Competitor';
    default:
      return 'Other';
  }
};

/** Text colour of a sentiment value: green positive, red negative, else gray. */
export const sentimentTextColor = (sentiment: string | undefined): string => {
  if (sentiment === 'positive') return 'text-emerald-700';
  if (sentiment === 'negative') return 'text-red-700';
  return 'text-gray-600';
};
