import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

export function wrapperAt(path: string) {
  function PrintModeRouter({ children }: Readonly<{ children: ReactNode }>) {
    return <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>;
  }
  return PrintModeRouter;
}
