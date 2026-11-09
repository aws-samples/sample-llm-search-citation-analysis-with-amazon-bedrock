import type { ComponentType } from 'react';
import {
  expect, it
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import type { ReportSlice } from './sectionGate';
import { sectionPlaceholderCases } from './sectionGate-fixtures';

/** A section with no data yet shows `loadingText` while its fetch runs, then the fetch's error. */
export function itRendersSectionPlaceholders<T>(section: ComponentType<ReportSlice<T>>, loadingText: RegExp | string): void {
  const Section = section;
  it.each(sectionPlaceholderCases(loadingText))('renders the $name', ({
    state, text
  }) => {
    render(<Section data={null} {...state} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });
}
