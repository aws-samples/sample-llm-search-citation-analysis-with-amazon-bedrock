import DOMPurify from 'dompurify';

/**
 * SECURITY: All user-generated content (AI provider responses) is sanitized via DOMPurify
 * before rendering with dangerouslySetInnerHTML. This prevents XSS attacks from malicious
 * content in AI responses.
 * 
 * Sanitization config:
 * - ALLOWED_TAGS: Only safe formatting tags (strong, em, code, a)
 * - ALLOWED_ATTR: Only safe attributes (href, target, rel, class)
 * - ALLOWED_URI_REGEXP: Only http/https URLs allowed in href attributes
 */
export const formatInlineMarkdown = (text: string): string => {
  // Convert markdown to HTML
  const step1 = text.replaceAll('**', '<strong class="font-semibold">').replaceAll('**', '</strong>');
  const step2 = step1.replaceAll('*', '<em class="italic">').replaceAll('*', '</em>');
  const step3 = step2.replaceAll('`', '<code class="bg-gray-100 px-1 py-0.5 rounded text-sm font-mono">').replaceAll('`', '</code>');
  
  // SECURITY: Sanitize HTML to prevent XSS from AI-generated content
  return DOMPurify.sanitize(step3, {
    ALLOWED_TAGS: ['strong', 'em', 'code', 'a'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
    ALLOWED_URI_REGEXP: /^https?:\/\//,
  });
};

const createTableBlock = (tableLines: string[], blockIndex: number): JSX.Element => {
  const headers = tableLines[0].split('|').map(h => h.trim()).filter(h => h);
  const rows = tableLines.slice(2).map(row => 
    row.split('|').map(cell => cell.trim()).filter(cell => cell)
  );

  return (
    <div key={`table-${blockIndex}`} className="overflow-x-auto my-4">
      <table className="min-w-full border border-gray-300">
        <thead className="bg-gray-100">
          <tr>
            {headers.map((header) => (
              <th key={`header-${header.slice(0, 10)}`} className="px-4 py-2 border border-gray-300 text-left text-sm font-semibold text-gray-900">
                <span dangerouslySetInnerHTML={{ __html: formatInlineMarkdown(header) }} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`row-${row[0]?.slice(0, 10) ?? 'empty'}`} className="hover:bg-gray-50">
              {row.map((cell) => (
                <td key={`cell-${cell.slice(0, 10)}`} className="px-4 py-2 border border-gray-300 text-sm text-gray-700">
                  <span dangerouslySetInnerHTML={{ __html: formatInlineMarkdown(cell) }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const createHeaderBlock = (line: string, blockIndex: number): JSX.Element => {
  if (line.startsWith('###')) {
    const text = line.replace(/^###\s*/, '');
    return <h3 key={`h3-${blockIndex}`} className="text-lg font-bold text-gray-900 mt-6 mb-3" dangerouslySetInnerHTML={{ __html: formatInlineMarkdown(text) }} />;
  }
  if (line.startsWith('##')) {
    const text = line.replace(/^##\s*/, '');
    return <h2 key={`h2-${blockIndex}`} className="text-xl font-bold text-gray-900 mt-6 mb-3" dangerouslySetInnerHTML={{ __html: formatInlineMarkdown(text) }} />;
  }
  const text = line.replace(/^#\s*/, '');
  return <h1 key={`h1-${blockIndex}`} className="text-2xl font-bold text-gray-900 mt-6 mb-4" dangerouslySetInnerHTML={{ __html: formatInlineMarkdown(text) }} />;
};

const createListBlock = (listItems: string[], isOrdered: boolean, blockIndex: number): JSX.Element => {
  const ListTag = isOrdered ? 'ol' : 'ul';
  const listClass = isOrdered ? 'list-decimal' : 'list-disc';
  
  return (
    <ListTag key={`list-${blockIndex}`} className={`${listClass} list-inside space-y-2 my-4`}>
      {listItems.map((item) => (
        <li key={`item-${item.slice(0, 20)}`} dangerouslySetInnerHTML={{ __html: formatInlineMarkdown(item) }} className="text-gray-700" />
      ))}
    </ListTag>
  );
};

const isListLine = (line: string): boolean => {
  const listPrefixes = ['- ', '* ', '• ', '1. ', '2. ', '3. ', '4. ', '5. ', '6. ', '7. ', '8. ', '9. ', '0. '];
  return listPrefixes.some(prefix => line.startsWith(prefix));
};

const isHeaderLine = (line: string): boolean => {
  return line.startsWith('#');
};

const isTableLine = (line: string): boolean => {
  return line.includes('|');
};

const processListItem = (trimmedLine: string): {
  item: string;
  isOrdered: boolean 
} => {
  if (trimmedLine.startsWith('- ')) return {
    item: trimmedLine.slice(2),
    isOrdered: false 
  };
  if (trimmedLine.startsWith('* ')) return {
    item: trimmedLine.slice(2),
    isOrdered: false 
  };
  if (trimmedLine.startsWith('• ')) return {
    item: trimmedLine.slice(2),
    isOrdered: false 
  };
  
  const dotIndex = trimmedLine.indexOf('. ');
  if (dotIndex > 0) {
    return {
      item: trimmedLine.slice(dotIndex + 2),
      isOrdered: true 
    };
  }
  
  return {
    item: trimmedLine,
    isOrdered: false 
  };
};

export const formatResponse = (text: string): JSX.Element[] => {
  if (!text) return [];

  const blocks: JSX.Element[] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    if (isHeaderLine(trimmedLine)) {
      blocks.push(createHeaderBlock(trimmedLine, blocks.length));
    } else if (isTableLine(trimmedLine)) {
      const tableLines = [line];
      blocks.push(createTableBlock(tableLines, blocks.length));
    } else if (isListLine(trimmedLine)) {
      const {
        item, isOrdered 
      } = processListItem(trimmedLine);
      blocks.push(createListBlock([item], isOrdered, blocks.length));
    } else {
      blocks.push(
        <p key={`para-${blocks.length}`} dangerouslySetInnerHTML={{ __html: formatInlineMarkdown(trimmedLine) }} className="text-gray-700 mb-4" />
      );
    }
  }

  return blocks;
};

const isValidHttpUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

export const extractUrls = (text: string): string[] => {
  const urls: string[] = [];
  const punctuation = ['.', ',', ';', ':', '!', '?'];

  for (const word of text.split(' ')) {
    if (!word.startsWith('http://') && !word.startsWith('https://')) continue;

    const cleanUrl = punctuation.reduce((url, punct) => {
      return url.endsWith(punct) ? url.slice(0, -1) : url;
    }, word);

    if (isValidHttpUrl(cleanUrl) && !urls.includes(cleanUrl)) {
      urls.push(cleanUrl);
    }
  }

  return urls;
};

export const findMentionPositions = (text: string, brandName: string): number[] => {
  const positions: number[] = [];
  const lowerText = text.toLowerCase();
  const lowerBrand = brandName.toLowerCase();
  
  const textLength = lowerText.length;
  const brandLength = lowerBrand.length;
  
  for (const startPos of Array.from({ length: textLength - brandLength + 1 }, (_, i) => i)) {
    if (lowerText.slice(startPos, startPos + brandLength) === lowerBrand) {
      positions.push(startPos);
    }
  }
  
  return positions;
};
