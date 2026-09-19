export function settledSlice(data: unknown) {
  return {
    data,
    loading: false,
    error: null
  };
}
