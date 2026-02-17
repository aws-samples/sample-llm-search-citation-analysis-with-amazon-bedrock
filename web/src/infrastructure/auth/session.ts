import { fetchAuthSession } from 'aws-amplify/auth';

/**
 * Get the current user's JWT token for API authentication
 */
export async function getAuthToken(): Promise<string | null> {
  try {
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? null;
  } catch (error) {
    console.error('Error fetching auth session:', error);
    return null;
  }
}

/**
 * Make an authenticated fetch request with JWT token
 */
export async function authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAuthToken();
  
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  });
}
