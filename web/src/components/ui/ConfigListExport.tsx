import { ExportAllButton } from './ExportAllButton';

/** The Settings lists Export all covers (2.45.0 wave 5, `config-lists`); `users` is Admin only. */
export type ConfigList = 'keywords' | 'keyword_groups' | 'markets' | 'personas' | 'schedules' | 'users';

/** Export all of one Settings list (every item, as the list holds it). */
export function ConfigListExport({ list }: { readonly list: ConfigList }) {
  return <ExportAllButton view="config-lists" params={{ list }} />;
}
