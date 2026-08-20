import {
  describe, expect, it
} from 'vitest';
import { formatInlineMarkdown } from './MarkdownProcessor';

describe('formatInlineMarkdown', () => {
  it('wraps a paired double-asterisk span in a strong tag', () => {
    expect(formatInlineMarkdown('best **Hotel Aurora** rates')).toBe(
      'best <strong class="font-semibold">Hotel Aurora</strong> rates'
    );
  });

  it('wraps a paired single-asterisk span in an em tag', () => {
    expect(formatInlineMarkdown('a *very* good stay')).toBe(
      'a <em class="italic">very</em> good stay'
    );
  });

  it('wraps a paired backtick span in a code tag', () => {
    expect(formatInlineMarkdown('run `npm test` first')).toBe(
      'run <code class="bg-gray-100 px-1 py-0.5 rounded text-sm font-mono">npm test</code> first'
    );
  });

  it('converts every pair when a line contains multiple bold spans', () => {
    expect(formatInlineMarkdown('**one** and **two**')).toBe(
      '<strong class="font-semibold">one</strong> and <strong class="font-semibold">two</strong>'
    );
  });

  it('nests em around strong when a span uses triple asterisks', () => {
    expect(formatInlineMarkdown('***both***')).toBe(
      '<em class="italic"><strong class="font-semibold">both</strong></em>'
    );
  });

  it('leaves an unpaired double-asterisk marker as literal text', () => {
    expect(formatInlineMarkdown('rating: 5 ** stars')).toBe('rating: 5 ** stars');
  });

  it('leaves an unpaired backtick as literal text', () => {
    expect(formatInlineMarkdown('the ` character')).toBe('the ` character');
  });

  it('strips script tags when input contains markup', () => {
    expect(formatInlineMarkdown('safe <script>alert(1)</script> text')).toBe('safe  text');
  });
});
