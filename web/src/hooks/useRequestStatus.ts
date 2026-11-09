import { useState } from 'react';

/** The loading flag and error message of a hook that fetches one thing at a time. */
export function useRequestStatus() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return {
    loading,
    setLoading,
    error,
    setError 
  };
}
