import {
  describe, expect, it
} from 'vitest';
import {
  hasSearchPoint, identityFields, identityOf, pointFields, rankBand, targetFields
} from './localSeoRequest';

describe('pointFields', () => {
  it('sends both coordinates when both are numbers', () => {
    expect(pointFields({
      latitude: '40.5',
      longitude: '-74' 
    })).toStrictEqual({
      latitude: 40.5,
      longitude: -74 
    });
  });

  it('sends no coordinate when one part is missing', () => {
    expect(pointFields({
      latitude: '40.5',
      longitude: '' 
    })).toStrictEqual({});
  });

  it('sends no coordinate when the latitude is beyond 90', () => {
    expect(pointFields({
      latitude: '91',
      longitude: '10' 
    })).toStrictEqual({});
  });
});

describe('hasSearchPoint', () => {
  it('falls back to the market city without a coordinate', () => {
    expect(hasSearchPoint({
      latitude: '',
      longitude: '' 
    }, true)).toBe(true);
  });

  it('cannot search without a coordinate or a market city', () => {
    expect(hasSearchPoint({
      latitude: '',
      longitude: '' 
    }, false)).toBe(false);
  });
});

describe('identityFields', () => {
  it('names the business by cid', () => {
    expect(identityFields({
      kind: 'cid',
      value: ' 42 ' 
    })).toStrictEqual({ cid: '42' });
  });

  it('names nothing for a blank value', () => {
    expect(identityFields({
      kind: 'name',
      value: '  ' 
    })).toBeNull();
  });

  it('targets the brand domains when no business is named', () => {
    expect(targetFields({
      kind: 'name',
      value: '' 
    })).toStrictEqual({});
  });

  it('prefers the cid of a listing over its place id', () => {
    expect(identityOf({
      cid: '1',
      place_id: 'p',
      title: 'Acme' 
    })).toStrictEqual({
      kind: 'cid',
      value: '1' 
    });
  });

  it('falls back to the title of a listing without ids', () => {
    expect(identityOf({
      cid: null,
      place_id: null,
      title: 'Acme' 
    })).toStrictEqual({
      kind: 'name',
      value: 'Acme' 
    });
  });
});

describe('rankBand', () => {
  it.each([[1, 'top3'], [3, 'top3'], [4, 'top10'], [10, 'top10'], [11, 'low'], [null, 'missing']] as const)(
    'puts rank %s in band %s', (rank, band) => {
      expect(rankBand(rank)).toBe(band);
    }
  );
});
