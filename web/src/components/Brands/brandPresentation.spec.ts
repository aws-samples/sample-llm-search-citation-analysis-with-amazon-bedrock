import {
  describe, expect, it
} from 'vitest';
import {
  classificationLabel, sentimentTextColor
} from './brandPresentation';

describe('classificationLabel', () => {
  it.each([
    ['first_party', 'First Party'],
    ['competitor', 'Competitor'],
    ['other', 'Other'],
    ['', 'Other'],
  ])('labels the %j classification as %j', (classification, label) => {
    expect(classificationLabel(classification)).toBe(label);
  });
});

describe('sentimentTextColor', () => {
  it.each([
    ['positive', 'text-green-600'],
    ['negative', 'text-red-600'],
    ['neutral', 'text-gray-600'],
    [undefined, 'text-gray-600'],
  ])('colours the %j sentiment with %j', (sentiment, colour) => {
    expect(sentimentTextColor(sentiment)).toBe(colour);
  });
});
