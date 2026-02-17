import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import { validateApiConfig } from './client';

// Mock the infrastructure module
vi.mock('../infrastructure', async () => {
  const actual = await vi.importActual('../infrastructure');
  return {
    ...actual,
    API_BASE_URL: 'https://api.example.com',
  };
});

describe('validateApiConfig', () => {
  it('does not throw when API_BASE_URL is valid', () => {
    expect(() => validateApiConfig()).not.toThrow();
  });
});

describe('validateApiConfig with placeholder', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('throws ApiConfigError when API_BASE_URL contains PLACEHOLDER', async () => {
    vi.doMock('../infrastructure', () => ({
      API_BASE_URL: 'PLACEHOLDER_URL',
      ApiConfigError: class extends Error {
        constructor(msg: string) { super(msg); this.name = 'ApiConfigError'; }
      },
    }));

    const { validateApiConfig: validate } = await import('./client');

    expect(() => validate()).toThrow('API URL not configured');
  });
});
