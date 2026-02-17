/**
 * DOCX export utility for content studio.
 * Converts markdown content to properly formatted Word documents.
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
} from 'docx';
import { saveAs } from 'file-saver';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type {
  Root, RootContent, PhrasingContent, TableCell as MdTableCell 
} from 'mdast';
import type { GeneratedContent } from '../types';

interface ExportOptions {
  content: GeneratedContent;
  keyword: string;
}

type DocxChild = Paragraph | Table;

/**
 * Parse markdown string to MDAST (Markdown Abstract Syntax Tree)
 */
function parseMarkdown(markdown: string): Root {
  const processor = unified().use(remarkParse).use(remarkGfm);
  return processor.parse(markdown);
}

/**
 * Convert inline/phrasing content to TextRun array
 */
function convertInlineContent(
  nodes: PhrasingContent[],
  inheritedStyles: {
    bold?: boolean;
    italic?: boolean 
  } = {}
): TextRun[] {
  const runs: TextRun[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        runs.push(new TextRun({
          text: node.value,
          bold: inheritedStyles.bold,
          italics: inheritedStyles.italic,
        }));
        break;

      case 'strong':
        runs.push(...convertInlineContent(node.children, {
          ...inheritedStyles,
          bold: true 
        }));
        break;

      case 'emphasis':
        runs.push(...convertInlineContent(node.children, {
          ...inheritedStyles,
          italic: true 
        }));
        break;

      case 'inlineCode':
        runs.push(new TextRun({
          text: node.value,
          font: 'Courier New',
          shading: { fill: 'E8E8E8' },
        }));
        break;

      case 'link':
        runs.push(...convertInlineContent(node.children, inheritedStyles));
        break;

      case 'delete':
        runs.push(...node.children.map(child => {
          if (child.type === 'text') {
            return new TextRun({
              text: child.value,
              strike: true,
              ...inheritedStyles,
            });
          }
          return new TextRun({ text: '' });
        }));
        break;

      default:
        if ('value' in node && typeof node.value === 'string') {
          runs.push(new TextRun({ text: node.value }));
        }
    }
  }

  return runs;
}

/**
 * Extract plain text from phrasing content for table cells
 */
function extractPlainText(nodes: PhrasingContent[]): string {
  return nodes.map(node => {
    if (node.type === 'text') return node.value;
    if ('children' in node) return extractPlainText(node.children as PhrasingContent[]);
    if ('value' in node && typeof node.value === 'string') return node.value;
    return '';
  }).join('');
}

/**
 * Convert MDAST table to docx Table
 */
function convertTable(node: { children: Array<{ children: MdTableCell[] }> }): Table {
  const rows = node.children.map((row, rowIndex) => {
    const cells = row.children.map(cell => {
      const textContent = extractPlainText(cell.children as PhrasingContent[]);
      return new TableCell({
        children: [new Paragraph({
          children: [new TextRun({
            text: textContent,
            bold: rowIndex === 0,
          })],
        })],
        shading: rowIndex === 0 ? { fill: 'E8E8E8' } : undefined,
      });
    });
    return new TableRow({ children: cells });
  });

  return new Table({
    rows,
    width: {
      size: 100,
      type: WidthType.PERCENTAGE 
    },
  });
}

/**
 * Convert a single MDAST node to docx elements
 */
function convertNode(node: RootContent, listLevel = 0): DocxChild[] {
  const elements: DocxChild[] = [];

  switch (node.type) {
    case 'heading': {
      const headingLevels: Record<number, typeof HeadingLevel[keyof typeof HeadingLevel]> = {
        1: HeadingLevel.HEADING_1,
        2: HeadingLevel.HEADING_2,
        3: HeadingLevel.HEADING_3,
        4: HeadingLevel.HEADING_4,
        5: HeadingLevel.HEADING_5,
        6: HeadingLevel.HEADING_6,
      };
      elements.push(new Paragraph({
        children: convertInlineContent(node.children),
        heading: headingLevels[node.depth] ?? HeadingLevel.HEADING_1,
        spacing: {
          before: 240,
          after: 120 
        },
      }));
      break;
    }

    case 'paragraph':
      elements.push(new Paragraph({
        children: convertInlineContent(node.children),
        spacing: { after: 200 },
      }));
      break;

    case 'list': {
      const isOrdered = node.ordered ?? false;
      node.children.forEach((item) => {
        if (item.type === 'listItem') {
          item.children.forEach(child => {
            if (child.type === 'paragraph') {
              elements.push(new Paragraph({
                children: convertInlineContent(child.children),
                bullet: isOrdered ? undefined : { level: listLevel },
                numbering: isOrdered ? {
                  reference: 'default-numbering',
                  level: listLevel 
                } : undefined,
                spacing: { after: 100 },
              }));
            } else if (child.type === 'list') {
              elements.push(...convertNode(child, listLevel + 1));
            }
          });
        }
      });
      break;
    }

    case 'blockquote':
      node.children.forEach(child => {
        if (child.type === 'paragraph') {
          elements.push(new Paragraph({
            children: convertInlineContent(child.children),
            indent: { left: 720 },
            border: {
              left: {
                style: BorderStyle.SINGLE,
                size: 24,
                color: '999999' 
              },
            },
            spacing: { after: 200 },
          }));
        }
      });
      break;

    case 'code':
      elements.push(new Paragraph({
        children: [new TextRun({
          text: node.value,
          font: 'Courier New',
          size: 20,
        })],
        shading: { fill: 'F5F5F5' },
        spacing: {
          before: 200,
          after: 200 
        },
      }));
      break;

    case 'table':
      elements.push(convertTable(node));
      break;

    case 'thematicBreak':
      elements.push(new Paragraph({
        children: [],
        border: {
          bottom: {
            style: BorderStyle.SINGLE,
            size: 6,
            color: 'CCCCCC' 
          } 
        },
        spacing: {
          before: 200,
          after: 200 
        },
      }));
      break;

    default:
      break;
  }

  return elements;
}

/**
 * Convert full markdown to docx children array
 */
function markdownToDocxChildren(markdown: string): DocxChild[] {
  const ast = parseMarkdown(markdown);
  const children: DocxChild[] = [];

  for (const node of ast.children) {
    children.push(...convertNode(node));
  }

  return children;
}

/**
 * Export generated content to a downloadable DOCX file.
 */
export async function exportToDocx({
  content,
  keyword,
}: ExportOptions): Promise<void> {
  const bodyChildren = markdownToDocxChildren(content.body);

  const keyPointsParagraphs = content.key_points.map(point =>
    new Paragraph({
      children: [new TextRun({ text: point })],
      bullet: { level: 0 },
      spacing: { after: 100 },
    })
  );

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'default-numbering',
        levels: [
          {
            level: 0,
            format: 'decimal',
            text: '%1.',
            alignment: AlignmentType.START 
          },
          {
            level: 1,
            format: 'lowerLetter',
            text: '%2.',
            alignment: AlignmentType.START 
          },
          {
            level: 2,
            format: 'lowerRoman',
            text: '%3.',
            alignment: AlignmentType.START 
          },
        ],
      }],
    },
    sections: [{
      children: [
        new Paragraph({
          children: [new TextRun({
            text: content.title,
            bold: true,
            size: 48 
          })],
          heading: HeadingLevel.TITLE,
          spacing: { after: 400 },
        }),
        new Paragraph({
          children: [new TextRun({
            text: content.meta_description,
            italics: true,
            color: '666666' 
          })],
          spacing: { after: 400 },
        }),
        ...bodyChildren,
        new Paragraph({
          children: [new TextRun({
            text: 'Key Points',
            bold: true,
            size: 28 
          })],
          heading: HeadingLevel.HEADING_2,
          spacing: {
            before: 400,
            after: 200 
          },
        }),
        ...keyPointsParagraphs,
      ],
    }],
  });

  const blob = await Packer.toBlob(doc);
  const filename = `${keyword.replaceAll(/\s+/g, '-')}-content.docx`;
  saveAs(blob, filename);
}
