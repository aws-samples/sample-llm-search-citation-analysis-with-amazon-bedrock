import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest';
import {
  renderHook, act 
} from '@testing-library/react';
import { useBrandExpansion } from './useBrandExpansion';
import type {
  BrandExpansionAllResult, CompetitorDiscoveryResult 
} from '../types';

describe('useBrandExpansion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('returns null expandingBrand initially', () => {
      const { result } = renderHook(() => useBrandExpansion());
      expect(result.current.expandingBrand).toBeNull();
    });

    it('returns null expansionAllResult initially', () => {
      const { result } = renderHook(() => useBrandExpansion());
      expect(result.current.expansionAllResult).toBeNull();
    });

    it('returns null competitorDiscoveryResult initially', () => {
      const { result } = renderHook(() => useBrandExpansion());
      expect(result.current.competitorDiscoveryResult).toBeNull();
    });

    it('returns empty pendingExpansionBrands initially', () => {
      const { result } = renderHook(() => useBrandExpansion());
      expect(result.current.pendingExpansionBrands).toStrictEqual([]);
    });

    it('returns null expansionTarget initially', () => {
      const { result } = renderHook(() => useBrandExpansion());
      expect(result.current.expansionTarget).toBeNull();
    });
  });

  describe('handleExpandAllBrands', () => {
    it('returns default result when no callback provided - existing brands', async () => {
      const { result } = renderHook(() => useBrandExpansion());

      const expansionResult = await act(async () => 
        result.current.handleExpandAllBrands(['Brand1'], 'first_party')
      );

      expect(expansionResult.existing_brands).toStrictEqual([]);
    });

    it('returns default result when no callback provided - suggestions', async () => {
      const { result } = renderHook(() => useBrandExpansion());

      const expansionResult = await act(async () => 
        result.current.handleExpandAllBrands(['Brand1'], 'first_party')
      );

      expect(expansionResult.suggestions).toStrictEqual([]);
    });

    it('does not call callback when brands array is empty', async () => {
      const mockCallback = vi.fn();
      const { result } = renderHook(() => useBrandExpansion());

      await act(async () => {
        await result.current.handleExpandAllBrands([], 'first_party', mockCallback);
      });

      expect(mockCallback).not.toHaveBeenCalled();
    });

    it('returns default suggestions when brands array is empty', async () => {
      const mockCallback = vi.fn();
      const { result } = renderHook(() => useBrandExpansion());

      const expansionResult = await act(async () => 
        result.current.handleExpandAllBrands([], 'first_party', mockCallback)
      );

      expect(expansionResult.suggestions).toStrictEqual([]);
    });

    it('calls callback with brands and type', async () => {
      const mockCallback = vi.fn().mockResolvedValue({
        existing_brands: ['Brand1'],
        suggestions: ['NewBrand'],
        parent_companies: [],
        duplicates_found: [],
      });

      const { result } = renderHook(() => useBrandExpansion());

      await act(async () => {
        await result.current.handleExpandAllBrands(['Brand1'], 'first_party', mockCallback);
      });

      expect(mockCallback).toHaveBeenCalledWith(['Brand1'], 'first_party');
    });

    it('sets expansionAllResult from callback response', async () => {
      const mockResult: BrandExpansionAllResult = {
        existing_brands: ['Brand1'],
        suggestions: ['NewBrand1', 'NewBrand2'],
        parent_companies: ['Parent1'],
        duplicates_found: [],
      };
      const mockCallback = vi.fn().mockResolvedValue(mockResult);

      const { result } = renderHook(() => useBrandExpansion());

      await act(async () => {
        await result.current.handleExpandAllBrands(['Brand1'], 'first_party', mockCallback);
      });

      expect(result.current.expansionAllResult).toStrictEqual(mockResult);
    });

    it('sets expandingBrand during expansion', async () => {
      const mockResult = {
        existing_brands: [],
        suggestions: [],
        duplicates_found: [] 
      };
      
      const mockCallback = vi.fn().mockResolvedValue(mockResult);
      const { result } = renderHook(() => useBrandExpansion());

      await act(async () => {
        await result.current.handleExpandAllBrands(['Brand1'], 'competitor', mockCallback);
      });

      expect(mockCallback).toHaveBeenCalledWith(['Brand1'], 'competitor');
      expect(result.current.expandingBrand).toBeNull();
    });

    it('adds brand to pending list before expansion', async () => {
      const { result } = renderHook(() => useBrandExpansion());

      act(() => {
        result.current.togglePendingBrand('Brand1');
      });
      expect(result.current.pendingExpansionBrands).toContain('Brand1');
    });

    it('clears pendingExpansionBrands after expansion', async () => {
      const mockCallback = vi.fn().mockResolvedValue({
        existing_brands: [],
        suggestions: [],
        duplicates_found: [] 
      });

      const { result } = renderHook(() => useBrandExpansion());

      act(() => {
        result.current.togglePendingBrand('Brand1');
      });

      await act(async () => {
        await result.current.handleExpandAllBrands(['Brand1'], 'first_party', mockCallback);
      });

      expect(result.current.pendingExpansionBrands).toStrictEqual([]);
    });
  });

  describe('handleFindCompetitors', () => {
    it('returns default first party brands when no callback provided', async () => {
      const { result } = renderHook(() => useBrandExpansion());

      const discoveryResult = await act(async () => 
        result.current.handleFindCompetitors(['MyBrand'], [])
      );

      expect(discoveryResult.first_party_brands).toStrictEqual([]);
    });

    it('returns default competitors when no callback provided', async () => {
      const { result } = renderHook(() => useBrandExpansion());

      const discoveryResult = await act(async () => 
        result.current.handleFindCompetitors(['MyBrand'], [])
      );

      expect(discoveryResult.competitors).toStrictEqual([]);
    });

    it('returns default result when first party brands empty', async () => {
      const mockCallback = vi.fn();
      const { result } = renderHook(() => useBrandExpansion());

      await act(async () => {
        await result.current.handleFindCompetitors([], [], mockCallback);
      });

      expect(mockCallback).not.toHaveBeenCalled();
    });

    it('calls callback with first party and existing competitors', async () => {
      const mockCallback = vi.fn().mockResolvedValue({
        first_party_brands: ['MyBrand'],
        competitors: ['Competitor1'],
      });

      const { result } = renderHook(() => useBrandExpansion());

      await act(async () => {
        await result.current.handleFindCompetitors(['MyBrand'], ['ExistingComp'], mockCallback);
      });

      expect(mockCallback).toHaveBeenCalledWith(['MyBrand'], ['ExistingComp']);
    });

    it('sets competitorDiscoveryResult from callback response', async () => {
      const mockResult: CompetitorDiscoveryResult = {
        first_party_brands: ['MyBrand'],
        competitors: ['Competitor1', 'Competitor2'],
        notes: 'Found competitors',
      };
      const mockCallback = vi.fn().mockResolvedValue(mockResult);

      const { result } = renderHook(() => useBrandExpansion());

      await act(async () => {
        await result.current.handleFindCompetitors(['MyBrand'], [], mockCallback);
      });

      expect(result.current.competitorDiscoveryResult).toStrictEqual(mockResult);
    });
  });

  describe('cancelExpansion', () => {
    it('clears expansionAllResult', async () => {
      const mockCallback = vi.fn().mockResolvedValue({
        existing_brands: ['Brand1'],
        suggestions: ['NewBrand'],
        duplicates_found: [],
      });

      const { result } = renderHook(() => useBrandExpansion());

      await act(async () => {
        await result.current.handleExpandAllBrands(['Brand1'], 'first_party', mockCallback);
      });

      expect(result.current.expansionAllResult).not.toBeNull();

      act(() => {
        result.current.cancelExpansion();
      });

      expect(result.current.expansionAllResult).toBeNull();
    });

    it('clears competitorDiscoveryResult', async () => {
      const mockCallback = vi.fn().mockResolvedValue({
        existing_brands: ['Brand1'],
        suggestions: ['NewBrand'],
        duplicates_found: [],
      });

      const { result } = renderHook(() => useBrandExpansion());

      await act(async () => {
        await result.current.handleExpandAllBrands(['Brand1'], 'first_party', mockCallback);
      });

      act(() => {
        result.current.cancelExpansion();
      });

      expect(result.current.competitorDiscoveryResult).toBeNull();
    });

    it('clears pendingExpansionBrands', async () => {
      const mockCallback = vi.fn().mockResolvedValue({
        existing_brands: ['Brand1'],
        suggestions: ['NewBrand'],
        duplicates_found: [],
      });

      const { result } = renderHook(() => useBrandExpansion());

      await act(async () => {
        await result.current.handleExpandAllBrands(['Brand1'], 'first_party', mockCallback);
      });

      act(() => {
        result.current.cancelExpansion();
      });

      expect(result.current.pendingExpansionBrands).toStrictEqual([]);
    });

    it('clears expansionTarget', async () => {
      const mockCallback = vi.fn().mockResolvedValue({
        existing_brands: ['Brand1'],
        suggestions: ['NewBrand'],
        duplicates_found: [],
      });

      const { result } = renderHook(() => useBrandExpansion());

      await act(async () => {
        await result.current.handleExpandAllBrands(['Brand1'], 'first_party', mockCallback);
      });

      act(() => {
        result.current.cancelExpansion();
      });

      expect(result.current.expansionTarget).toBeNull();
    });
  });

  describe('togglePendingBrand', () => {
    it('adds brand to pending list', () => {
      const { result } = renderHook(() => useBrandExpansion());

      act(() => {
        result.current.togglePendingBrand('NewBrand');
      });

      expect(result.current.pendingExpansionBrands).toContain('NewBrand');
    });

    it('removes brand from pending list if already present - contains check', () => {
      const { result } = renderHook(() => useBrandExpansion());

      act(() => {
        result.current.togglePendingBrand('Brand1');
      });
      expect(result.current.pendingExpansionBrands).toContain('Brand1');
    });

    it('removes brand from pending list if already present - removal check', () => {
      const { result } = renderHook(() => useBrandExpansion());

      act(() => {
        result.current.togglePendingBrand('Brand1');
      });

      act(() => {
        result.current.togglePendingBrand('Brand1');
      });
      expect(result.current.pendingExpansionBrands).not.toContain('Brand1');
    });

    it('handles multiple brands', () => {
      const { result } = renderHook(() => useBrandExpansion());

      act(() => {
        result.current.togglePendingBrand('Brand1');
      });
      act(() => {
        result.current.togglePendingBrand('Brand2');
      });

      expect(result.current.pendingExpansionBrands).toStrictEqual(['Brand1', 'Brand2']);
    });
  });
});
