import {
  describe, it, expect
} from 'vitest';
import { screen } from '@testing-library/react';
import { usesIamAuth } from '../../constants/providers';
import {
  buildIamProvider, buildProviderConfig, renderProvidersConfig
} from './ProvidersConfig-fixtures';

describe('ProvidersConfig IAM provider', () => {
  it.each([true, false])('offers no key button when the gateway is deployed: %s', (configured) => {
    renderProvidersConfig([buildIamProvider({ configured })]);

    expect(screen.queryByRole('button', { name: 'Add Key' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update Key' })).not.toBeInTheDocument();
  });

  describe('when the gateway is deployed', () => {
    it('says no key is needed', () => {
      renderProvidersConfig([buildIamProvider()]);

      expect(screen.getByText('IAM — no key needed')).toBeInTheDocument();
      expect(screen.queryByText('Configured')).not.toBeInTheDocument();
    });

    it('lets an administrator toggle the provider', () => {
      renderProvidersConfig([buildIamProvider()]);

      expect(screen.getByRole('button', { name: 'Disable' })).toBeEnabled();
    });

    it('labels the link Documentation', () => {
      renderProvidersConfig([buildIamProvider()]);

      expect(screen.getByRole('link', { name: 'Documentation' })).toHaveAttribute(
        'href',
        'https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-target-connector-web-search-tool.html'
      );
      expect(screen.queryByRole('link', { name: 'Get API Key' })).not.toBeInTheDocument();
    });
  });

  describe('when the gateway is not deployed', () => {
    it('says the gateway is not deployed', () => {
      renderProvidersConfig([buildIamProvider({ configured: false })]);

      expect(screen.getByText('Gateway not deployed')).toBeInTheDocument();
      expect(screen.queryByText('Not configured')).not.toBeInTheDocument();
    });

    it('disables the toggle with an explanation instead of the API key hint', () => {
      renderProvidersConfig([buildIamProvider({ configured: false })]);

      const toggle = screen.getByTitle(/Gateway not deployed/);

      expect(toggle).toBeDisabled();
      expect(screen.queryByTitle('Configure API key first')).not.toBeInTheDocument();
    });
  });

  describe('for key-based providers', () => {
    it('keeps the Update Key button and the Get API Key link', () => {
      renderProvidersConfig([buildProviderConfig({ auth: 'api_key' })]);

      expect(screen.getByRole('button', { name: 'Update Key' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Get API Key' })).toBeInTheDocument();
    });

    it('keeps Add Key and the key hint for an unconfigured provider whose auth is missing', () => {
      renderProvidersConfig([buildProviderConfig({
        configured: false,
        masked_key: null,
      })]);

      expect(screen.getByRole('button', { name: 'Add Key' })).toBeInTheDocument();
      expect(screen.getByTitle('Configure API key first')).toBeDisabled();
    });

    it('treats a missing auth as an API key', () => {
      expect(usesIamAuth(buildProviderConfig())).toBe(false);
    });
  });
});
