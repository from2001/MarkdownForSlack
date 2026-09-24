import { Marked, Tokenizer } from './vendor/marked.esm.js';

const markdown = new Marked({
  gfm: true,
  breaks: true,
  tokenizer: {
    emStrong(source, maskedSource, previousCharacter) {
      if (!/^\*\*(?!\*)/.test(source)) return false;
      // Allow **Label:**text and **項目：**本文 without adding visible whitespace.
      // Change only the delimiter mask, preserving source offsets and Marked's
      // existing protection for escaped stars, code, and link destinations.
      const relaxedMask = maskedSource.replace(/[:：](?=\*\*(?!\*))/g, 'a');
      return Tokenizer.prototype.emStrong.call(this, source, relaxedMask, previousCharacter);
    },
  },
});

const text = (value) => ({ type: 'text', value });
const paragraph = (children) => ({ type: 'paragraph', children });
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

function safeUrl(value) {
  if (/[\s\u0000-\u001f\u007f]/u.test(value)) return false;
  try {
    return ['https:', 'http:', 'mailto:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function inlinePlain(nodes) {
  return nodes.map((node) => {
    if (node.type === 'break') return '\n';
    if (node.value !== undefined) return node.value;
    const label = inlinePlain(node.children);
    if (node.type !== 'link') return label;
    return label === node.url || `mailto:${label}` === node.url
      ? label : `${label} (${node.url})`;
  }).join('');
}

function inlineHtml(nodes) {
  return nodes.map((node) => {
    if (node.type === 'text') return escapeHtml(node.value).replace(/\n/g, '<br>');
    if (node.type === 'break') return '<br>';
    if (node.type === 'code') return `<code>${escapeHtml(node.value)}</code>`;
    const content = inlineHtml(node.children);
    if (node.type === 'link') return `<a href="${escapeHtml(node.url)}">${content}</a>`;
    const tag = { strong: 'strong', em: 'em', del: 's' }[node.type];
    return `<${tag}>${content}</${tag}>`;
  }).join('');
}

function blocksHtml(blocks) {
  return blocks.map((block) => {
    if (block.type === 'paragraph') return `<p>${inlineHtml(block.children)}</p>`;
    if (block.type === 'code') return `<pre><code>${escapeHtml(block.value)}</code></pre>`;
    if (block.type === 'quote') return `<blockquote>${blocksHtml(block.children)}</blockquote>`;
    const tag = block.ordered ? 'ol' : 'ul';
    const start = block.ordered ? ` start="${block.start}"` : '';
    return `<${tag}${start}>${block.items.map((item) => `<li>${blocksHtml(item)}</li>`).join('')}</${tag}>`;
  }).join('');
}

function blocksPlain(blocks, separator = '\n\n') {
  return blocks.map((block) => {
    if (block.type === 'paragraph') return inlinePlain(block.children);
    if (block.type === 'code') return block.value;
    if (block.type === 'quote') {
      return blocksPlain(block.children).split('\n').map((line) => `> ${line}`).join('\n');
    }
    return block.items.map((item, index) => {
      const prefix = block.ordered ? `${block.start + index}. ` : '• ';
      const lines = blocksPlain(item, '\n').split('\n');
      return prefix + lines.join(`\n${' '.repeat(prefix.length)}`);
    }).join('\n');
  }).join(separator);
}

// Approximate terminal cell widths for the optional monospace table view.
function displayWidth(value) {
  return [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(value)]
    .reduce((total, { segment }) => total + (
      /[\p{Extended_Pictographic}\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe6f\uff01-\uff60\uffe0-\uffe6\u{20000}-\u{3fffd}]/u.test(segment)
        ? 2 : /^\p{Mark}+$/u.test(segment) ? 0 : 1
    ), 0);
}

function monospaceTable(headers, rows) {
  const cells = [headers, ...rows].map((row) => row.map((cell) => inlinePlain(cell).replace(/\n/g, ' / ')));
  const widths = headers.map((_, index) => Math.max(1, ...cells.map((row) => displayWidth(row[index] || ''))));
  const lines = cells.map((row) => row.map((cell, index) => cell + ' '.repeat(widths[index] - displayWidth(cell))).join(' | '));
  lines.splice(1, 0, widths.map((width) => '-'.repeat(width)).join('-+-'));
  return lines.join('\n');
}

/** Normalize Markdown once, then derive both clipboard formats from that model. */
export function convertMarkdown(source, { tableMode = 'fields', document = globalThis.document } = {}) {
  const decoder = document.createElement('textarea');
  const decode = (value) => {
    // RCDATA decodes entities without interpreting input as HTML elements.
    decoder.innerHTML = value.replace(/</g, '&lt;');
    return decoder.value;
  };
  const changes = { headings: 0, tables: 0, tasks: 0, images: 0, dividers: 0, rawHtml: 0, unsafeLinks: 0, unknown: 0 };

  function rawHtml(value) {
    if (/^<br\s*\/?\s*>$/i.test(value.trim())) return { type: 'break' };
    changes.rawHtml++;
    return text(value);
  }

  function link(url, children) {
    const decoded = decode(url);
    if (safeUrl(decoded)) return { type: 'link', url: decoded, children };
    changes.unsafeLinks++;
    const label = inlinePlain(children);
    return text(label === decoded ? label : `${label} (${decoded})`);
  }

  function inlines(tokens = []) {
    return tokens.flatMap((token) => {
      switch (token.type) {
        case 'strong':
        case 'em':
        case 'del':
          return { type: token.type, children: inlines(token.tokens) };
        case 'codespan': return { type: 'code', value: token.text };
        case 'br': return { type: 'break' };
        case 'link': return link(token.href, inlines(token.tokens));
        case 'image': {
          changes.images++;
          const label = inlinePlain(inlines(token.tokens)) || decode(token.text) || '画像';
          return [text('画像：'), link(token.href, [text(label)])];
        }
        case 'html': return rawHtml(token.text);
        case 'escape': return text(token.text);
        case 'text': return token.tokens ? inlines(token.tokens) : text(decode(token.text));
        default:
          changes.unknown++;
          return text(token.raw || token.text || '');
      }
    });
  }

  function table(token) {
    changes.tables++;
    const headers = token.header.map((cell, index) => {
      const content = inlines(cell.tokens);
      return inlinePlain(content).trim() ? content : [text(`列${index + 1}`)];
    });
    const rows = token.rows.map((row) => row.map((cell) => inlines(cell.tokens)));
    if (tableMode === 'code') return [{ type: 'code', value: monospaceTable(headers, rows) }];
    if (!rows.length) {
      return [paragraph([{ type: 'strong', children: headers.flatMap((header, index) => index ? [text(' / '), ...header] : header) }])];
    }
    return rows.map((row) => paragraph(headers.flatMap((header, index) => [
      ...(index ? [{ type: 'break' }] : []),
      { type: 'strong', children: [...header, text('：')] },
      ...(row[index] || []),
    ])));
  }

  function blocks(tokens) {
    return tokens.flatMap((token) => {
      switch (token.type) {
        case 'space':
        case 'def':
        case 'checkbox': return [];
        case 'heading':
          changes.headings++;
          return paragraph([{ type: 'strong', children: inlines(token.tokens) }]);
        case 'paragraph':
        case 'text': return paragraph(token.tokens ? inlines(token.tokens) : [text(decode(token.text))]);
        case 'code': return { type: 'code', value: token.text };
        case 'blockquote': return { type: 'quote', children: blocks(token.tokens) };
        case 'hr':
          changes.dividers++;
          return paragraph([text('────────')]);
        case 'html': return paragraph([rawHtml(token.text)]);
        case 'table': return table(token);
        case 'list': return {
          type: 'list', ordered: token.ordered, start: token.ordered ? token.start : 1,
          items: token.items.map((item) => {
            const content = blocks(item.tokens);
            if (item.task) {
              changes.tasks++;
              const marker = text(item.checked ? '☑ ' : '☐ ');
              if (content[0]?.type === 'paragraph') content[0].children.unshift(marker);
              else content.unshift(paragraph([marker]));
            }
            return content;
          }),
        };
        default:
          changes.unknown++;
          return paragraph([text(token.raw || token.text || '')]);
      }
    });
  }

  const normalized = blocks(markdown.lexer(source));
  return { blocks: normalized, html: blocksHtml(normalized), plain: blocksPlain(normalized), changes };
}
