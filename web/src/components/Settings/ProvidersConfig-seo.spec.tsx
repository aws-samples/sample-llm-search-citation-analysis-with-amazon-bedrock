import {
  beforeEach, describe, it, expect, vi
} from 'vitest';
import {
  fireEvent, screen, waitFor, within
} from '@testing-library/react';
import type { ProvidersConfigProps } from './ProvidersConfig';
import {
  buildAiOverviewProvider, buildDataForSeoProvider, buildProviderConfig, renderProvidersConfig
} from './ProvidersConfig-fixtures';
import {
  buildSeoAccount, mockFetchSeoAccount, mockIsSeoApiConfigured
} from '../../hooks/useSeoAccount-fixtures';
import { validateProviderKey } from '../../api/providerKeys';

vi.mock('../../api/seo', () => import('../../hooks/useSeoAccount-fixtures'));
vi.mock('../../api/providerKeys', () => ({ validateProviderKey: vi.fn<typeof validateProviderKey>() }));

// `mockReturnValue` outlives a test; every one starts with the SEO stack undeployed.
beforeEach(() => {
  mockIsSeoApiConfigured.mockReturnValue(false);
});

const STORED_DATAFORSEO = buildDataForSeoProvider({
  configured: true,
  masked_key: 'seo@example.com',
});

const JOINED_LOGIN = 'seo@example.com:pa55word';

/** Opens the empty login form, types `login` and `password`, and presses `button`. */
function setupSubmittedLogin(button: 'Save' | 'Check login', password = 'pa55word') {
  const onUpdate = vi.fn<ProvidersConfigProps['onUpdate']>().mockResolvedValue(true);
  renderProvidersConfig([buildDataForSeoProvider()], { onUpdate });
  fireEvent.click(screen.getByRole('button', { name: 'Add Key' }));
  fireEvent.change(screen.getByLabelText('Login'), { target: { value: 'seo@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: button }));
  return onUpdate;
}

describe('ProvidersConfig DataForSEO card', () => {
  it('saves the login and password joined as login:password', async () => {
    const onUpdate = setupSubmittedLogin('Save');

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('dataforseo', { api_key: JOINED_LOGIN }));
  });

  it('clears the password from the page once the login is saved', async () => {
    setupSubmittedLogin('Save');

    await waitFor(() => expect(screen.queryByLabelText('Password')).not.toBeInTheDocument());
    expect(screen.queryByDisplayValue('pa55word')).not.toBeInTheDocument();
  });

  it('masks the password input of a stored login and opens it empty', () => {
    renderProvidersConfig([STORED_DATAFORSEO]);

    fireEvent.click(screen.getByRole('button', { name: 'Update Key' }));

    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('refuses to save without a password', () => {
    const onUpdate = setupSubmittedLogin('Save', ' ');

    expect(screen.getByText('Password cannot be empty')).toBeInTheDocument();
    expect(onUpdate).not.toHaveBeenCalledWith('dataforseo', expect.anything());
  });

  it('shows the masked login of a stored key', () => {
    renderProvidersConfig([STORED_DATAFORSEO]);

    expect(screen.getByText('seo@example.com')).toBeInTheDocument();
  });

  it('checks the typed login with the validate call without saving it', async () => {
    vi.mocked(validateProviderKey).mockResolvedValue({ valid: true });

    const onUpdate = setupSubmittedLogin('Check login');

    expect(await screen.findByText('Login accepted.')).toBeInTheDocument();
    expect(validateProviderKey).toHaveBeenCalledWith('dataforseo', JOINED_LOGIN);
    expect(onUpdate.mock.calls).toStrictEqual([]);
  });

  it('shows the reason a checked login was rejected', async () => {
    vi.mocked(validateProviderKey).mockResolvedValue({
      valid: false,
      error: 'DataForSEO rejected the login',
    });

    setupSubmittedLogin('Check login');

    expect(await screen.findByRole('alert')).toHaveTextContent('DataForSEO rejected the login');
  });

  it('lists the DataForSEO card under the SEO data group', () => {
    renderProvidersConfig([buildProviderConfig(), STORED_DATAFORSEO]);

    const group = screen.getByRole('region', { name: 'SEO data' });

    expect(within(group).getByRole('heading', { name: 'DataForSEO' })).toBeInTheDocument();
    expect(within(group).queryByRole('heading', { name: 'Claude' })).not.toBeInTheDocument();
  });
});

describe('ProvidersConfig DataForSEO balance', () => {
  it('shows the account balance to an administrator when the SEO stack is deployed', async () => {
    mockIsSeoApiConfigured.mockReturnValue(true);
    mockFetchSeoAccount.mockResolvedValue(buildSeoAccount({ balance_usd: 74.3 }));

    renderProvidersConfig([STORED_DATAFORSEO]);

    expect(await screen.findByText('Balance $74.30')).toBeInTheDocument();
  });

  it.each([
    ['when the SEO stack is not deployed', false, {}],
    ['for a user without the admin group', true, { isAdmin: false }],
  ])('reads no balance %s', (_case, deployed, overrides) => {
    mockIsSeoApiConfigured.mockReturnValue(deployed);

    renderProvidersConfig([STORED_DATAFORSEO], overrides);

    expect(mockFetchSeoAccount).not.toHaveBeenCalledWith();
  });
});

describe('ProvidersConfig Google AI Overviews card', () => {
  it('disables the toggle while DataForSEO has no key', () => {
    renderProvidersConfig([buildAiOverviewProvider({ configured: true }), buildDataForSeoProvider()]);

    expect(screen.getByTitle('Add the DataForSEO login first')).toBeDisabled();
  });

  it('enables the toggle once DataForSEO has a key', () => {
    renderProvidersConfig([buildAiOverviewProvider(), STORED_DATAFORSEO]);

    expect(screen.getByRole('button', { name: 'Enable' })).toBeEnabled();
  });

  it('says it uses the DataForSEO login', () => {
    renderProvidersConfig([buildAiOverviewProvider(), STORED_DATAFORSEO]);

    expect(screen.getByText('Uses the DataForSEO login')).toBeInTheDocument();
  });

  it('offers no key field of its own', () => {
    renderProvidersConfig([buildAiOverviewProvider()]);

    expect(screen.queryAllByRole('button', { name: /Key$/ })).toStrictEqual([]);
  });
});
