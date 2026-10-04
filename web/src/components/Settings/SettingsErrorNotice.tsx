/** Red banner with a settings page's last error; renders nothing without one. */
export const SettingsErrorNotice = ({ error }: { readonly error: string | null }) => (
  error ? <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div> : null
);
