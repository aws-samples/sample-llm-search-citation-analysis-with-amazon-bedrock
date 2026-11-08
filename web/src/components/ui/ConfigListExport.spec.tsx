import {
  describe, expect, it, vi
} from 'vitest';
import { render } from '@testing-library/react';
import {
  chooseExportFormat, mockStartExport
} from '../../test/exportsApiMock';
import { ConfigListExport } from './ConfigListExport';

vi.mock('../../api/exports', () => import('../../test/exportsApiMock'));

describe('ConfigListExport', () => {
  it('exports the named Settings list through config-lists', async () => {
    render(<ConfigListExport list="personas" />);

    await chooseExportFormat('csv');

    expect(mockStartExport).toHaveBeenCalledWith({
      view: 'config-lists',
      params: { list: 'personas' },
      format: 'csv',
    });
  });
});
