import {
  VALID_ALERT_SEVERITIES,
  VALID_ALERT_STATUSES,
  VALID_ALERT_TYPES,
} from './alerts-fixtures';

/** A list envelope carrying exactly one item, as a single-alert response arrives. */
export function buildSingleItemList(item: unknown) {
  return {
    items: [item],
    count: 1,
  };
}

export const EMPTY_LIST = {
  items: [],
  count: 0,
};

interface ListEnvelopeSamples {
  /** A valid response, whose properties a malformed array candidate carries. */
  response: object;
  validItem: unknown;
  malformedItem: unknown;
}

/** Envelopes every paginated-list decoder must reject, as `[condition, candidate]` rows. */
export function buildMalformedListEnvelopes({
  response, validItem, malformedItem
}: ListEnvelopeSamples): [string, unknown][] {
  return [
    ['the payload is null', null],
    ['the payload is an array', []],
    ['an array carries otherwise valid response properties', Object.assign([], response)],
    ['items is missing', { count: 0 }],
    ['count is negative', {
      items: [],
      count: -1,
    }],
    ['count is fractional', {
      items: [],
      count: 0.5,
    }],
    ['count is a string', {
      items: [],
      count: '0',
    }],
    ['count is not finite', {
      items: [],
      count: Number.POSITIVE_INFINITY,
    }],
    ['count is smaller than the item list', {
      items: [validItem],
      count: 0,
    }],
    ['items mixes valid and malformed entries', {
      items: [validItem, malformedItem],
      count: 2,
    }],
  ];
}

const SUPPORTED_VALUES_BY_FIELD = {
  type: VALID_ALERT_TYPES,
  severity: VALID_ALERT_SEVERITIES,
  status: VALID_ALERT_STATUSES,
};

/** Every supported alert type, severity and status, as `{ field, value }` rows. */
export const SUPPORTED_ALERT_FIELD_VALUES = Object.entries(SUPPORTED_VALUES_BY_FIELD)
  .flatMap(([field, values]) => values.map((value) => ({
    field,
    value,
  })));
