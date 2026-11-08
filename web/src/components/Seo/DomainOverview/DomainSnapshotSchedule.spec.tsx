import {
  fireEvent, render, screen
} from '@testing-library/react';
import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  fetchDomainSnapshotSchedule, setDomainSnapshotSchedule
} from '../../../api/seoDomains';
import { DomainSnapshotSchedule } from './DomainSnapshotSchedule';

vi.mock('../../../api/seo', () => import('../../../test/seoApiMock'));
vi.mock('../../../api/seoDomains');

const TURN_ON = { name: 'Turn weekly snapshot on' } as const;

beforeEach(() => {
  vi.mocked(fetchDomainSnapshotSchedule).mockResolvedValue({ schedule_enabled: false });
  vi.mocked(setDomainSnapshotSchedule).mockImplementation((enabled) => Promise.resolve({ schedule_enabled: enabled }));
  render(<DomainSnapshotSchedule />);
});

describe('DomainSnapshotSchedule', () => {
  it('shows the weekly sweep as off until an Admin turns it on', async () => {
    expect(await screen.findByText('Weekly snapshot is off.')).toBeInTheDocument();
    expect(screen.getByRole('button', TURN_ON)).toBeEnabled();
  });

  it('names the paid calls and changes nothing until the Admin confirms', async () => {
    fireEvent.click(await screen.findByRole('button', TURN_ON));

    expect(screen.getByRole('dialog')).toHaveTextContent('2 paid DataForSEO calls per domain and market');
    expect(setDomainSnapshotSchedule).not.toHaveBeenCalled();
  });

  it('turns the sweep on once confirmed, and off again without a confirmation', async () => {
    fireEvent.click(await screen.findByRole('button', TURN_ON));
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Turn weekly snapshot off' }));

    expect(vi.mocked(setDomainSnapshotSchedule).mock.calls).toStrictEqual([[true], [false]]);
    expect(await screen.findByText('Weekly snapshot is off.')).toBeInTheDocument();
  });
});
