/** A data slice whose request is still in flight. */
export const LOADING_SLICE = {
  data: null,
  loading: true,
  error: null,
} as const;

/** A data slice whose request failed with `error`. */
export function failedSlice(error: string) {
  return {
    data: null,
    loading: false,
    error,
  };
}
