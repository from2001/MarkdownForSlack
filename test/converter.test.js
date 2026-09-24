import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { convertMarkdown } from '../converter.js';

const { document } = new JSDOM('').window;
const convert = (source, options = {}) => convertMarkdown(source, { document, ...options });
const dom = (html) => JSDOM.fragment(html);

test('all heading levels become body-sized bold paragraphs, including setext headings', () => {
  const result = convert('# A\n## B\n### C\n#### D\n##### E\n###### F\n\nG\n===');
  assert.equal(dom(result.html).querySelectorAll('h1,h2,h3,h4,h5,h6').length, 0);
  assert.equal(dom(result.html).querySelectorAll('p > strong').length, 7);
  assert.equal(result.plain, 'A\n\nB\n\nC\n\nD\n\nE\n\nF\n\nG');
  assert.equal(result.changes.headings, 7);
});

test('tables preserve every row, header, empty cell, inline style and escaped pipe', () => {
  const result = convert('| プラン | 月額 | 備考 |\n|---|---:|---|\n| **Basic** | 1,000円 | |\n| Pro | 3,000円 | A\\|B<br>続き |');
  assert.equal(result.plain, 'プラン：Basic\n月額：1,000円\n備考：\n\nプラン：Pro\n月額：3,000円\n備考：A|B\n続き');
  assert.equal(dom(result.html).querySelector('table'), null);
  assert.match(result.html, /<strong>Basic<\/strong>/);
  assert.equal(result.changes.tables, 1);
});

test('tables with missing headers or no data rows do not discard content', () => {
  assert.equal(convert('| | Value |\n|---|---|\n| A | B |').plain, '列1：A\nValue：B');
  assert.equal(convert('| Name | Value |\n|---|---|').plain, 'Name / Value');
});

test('monospace tables align Japanese and Latin text while retaining URLs and empty cells', () => {
  const result = convert('| 名前 | 値 |\n|---|---|\n| 日本 | |\n| A | [資料](https://example.com) |', { tableMode: 'code' });
  assert.match(result.plain, /日本 \|/);
  assert.match(result.plain, /A {4}\| 資料 \(https:\/\/example.com\)/);
  assert.equal(dom(result.html).querySelector('pre code').textContent, result.plain);
});

test('nested numbered lists retain start numbers, continuation lines and task states', () => {
  const result = convert('3. **親**\n   - [ ] 未完了\n   - [x] 完了\n4. 次\n   継続');
  assert.equal(result.plain, '3. 親\n   • ☐ 未完了\n   • ☑ 完了\n4. 次\n   継続');
  assert.equal(dom(result.html).querySelector('ol').getAttribute('start'), '3');
  assert.equal(dom(result.html).querySelectorAll('ol ul li').length, 2);
  assert.equal(dom(result.html).querySelector('input'), null);
  assert.equal(result.changes.tasks, 2);
});

test('loose task lists contain exactly one visible checkbox per item', () => {
  const result = convert('- [x] Done\n\n  Additional paragraph\n\n- [ ] Pending');
  assert.equal((result.plain.match(/☑/g) || []).length, 1);
  assert.equal((result.plain.match(/☐/g) || []).length, 1);
  assert.match(result.plain, /Additional paragraph/);
});

test('code content is not decoded or treated as headings, tables, links or HTML', () => {
  const code = '# literal\n| A | B |\n**bold** &amp; <img src=x onerror=alert(1)>\n\n  indented';
  const result = convert('```html\n' + code + '\n```\n\n`&amp; **keep**`');
  assert.equal(dom(result.html).querySelector('pre code').textContent, code);
  assert.equal(dom(result.html).querySelector('p code').textContent, '&amp; **keep**');
  assert.equal(result.changes.headings + result.changes.tables + result.changes.rawHtml, 0);
});

test('links, reference links, email links and images keep destinations in plain text', () => {
  const result = convert('[資料][ref]\n\n[ref]: https://example.com?a=1&b=2\n\n<https://example.org> <person@example.org>\n\n![説明](https://example.com/image.png)');
  assert.match(result.plain, /資料 \(https:\/\/example.com\?a=1&b=2\)/);
  assert.match(result.plain, /https:\/\/example.org person@example.org/);
  assert.match(result.plain, /画像：説明 \(https:\/\/example.com\/image.png\)/);
  assert.equal(dom(result.html).querySelectorAll('a').length, 4);
  assert.equal(dom(result.html).querySelector('img'), null);
  assert.equal(result.changes.images, 1);
});

test('inline formatting, entities and line breaks survive normalization', () => {
  const result = convert('**太字と _斜体_** ~~削除~~ &amp; &copy; &lt;\n次の行');
  const fragment = dom(result.html);
  assert.equal(fragment.querySelector('strong em').textContent, '斜体');
  assert.equal(fragment.querySelector('s').textContent, '削除');
  assert.equal(result.plain, '太字と 斜体 削除 & © <\n次の行');
  assert.equal(fragment.querySelectorAll('br').length, 1);
});

for (const colon of [':', '：']) {
  test(`bold labels ending in ${colon} close before adjacent text in the reported list`, () => {
    const items = [
      ['ノーコード・マルチデバイス対応', 'プログラミング知識がなくてもXRコンテンツを制作・配信可能。Apple Vision Pro、Meta Quest、Pico、スマートフォン、Webブラウザなど多様なデバイスに対応しています。'],
      ['グローバルなクリエイターエコシステム', '世界39カ国以上にわたる97,000人以上の登録クリエイターコミュニティを擁し、15万以上のXRコンテンツが配信されています。'],
      ['ロケーションベースエンターテインメント（LBE）', '都市や商業施設、エンターテインメント空間に特化したXR体験を提供し、店舗・施設のメディア化を推進しています。'],
    ];
    const result = convert(items.map(([label, body]) => `- **${label}${colon}**${body}`).join('\n'));
    const list = dom(result.html).querySelectorAll('li');
    assert.equal(list.length, items.length);
    items.forEach(([label, body], index) => {
      assert.equal(list[index].querySelector('strong').textContent, label + colon);
      assert.equal(list[index].textContent, label + colon + body);
    });
    assert.equal(result.plain, items.map(([label, body]) => `• ${label}${colon}${body}`).join('\n'));
  });
}

test('colon-ended bold preserves adjacent formatting, nested code, links, and table cells', () => {
  const result = convert('前**項目：**説明**次:**text\n\n**_補足_ `値：**文字` [資料](https://example.com)：**本文\n\n[**リンク：**説明](https://example.org)\n\n| A | B |\n|---|---|\n| **表：**値 | 通常 |');
  const fragment = dom(result.html);
  assert.equal(fragment.querySelector('p').innerHTML, '前<strong>項目：</strong>説明<strong>次:</strong>text');
  assert.equal(fragment.querySelector('strong em').textContent, '補足');
  assert.equal(fragment.querySelector('strong code').textContent, '値：**文字');
  assert.equal(fragment.querySelector('strong a').getAttribute('href'), 'https://example.com');
  assert.equal(fragment.querySelector('a strong').textContent, 'リンク：');
  assert.match(result.html, /<strong>表：<\/strong>値/);
  assert.match(result.plain, /資料 \(https:\/\/example.com\)：本文/);
});

test('colon-ended bold leaves literal contexts, escapes, unfinished input, and other emphasis unchanged', () => {
  const literal = '**項目：**説明';
  const result = convert('```md\n' + literal + '\n```\n\n    ' + literal + '\n\n`' + literal + '`\n\n'
    + String.raw`\*\*項目：\*\*説明` + '\n\n[資料](https://example.com/:**path)\n\n<span title="' + literal + '">text</span>');
  const fragment = dom(result.html);
  assert.equal(fragment.querySelector('strong'), null);
  assert.deepEqual([...fragment.querySelectorAll('code')].map((node) => node.textContent), [literal, literal, literal]);
  assert.equal(fragment.querySelector('a').getAttribute('href'), 'https://example.com/:**path');
  assert.ok(result.plain.includes(literal));
  assert.ok(result.plain.includes('<span title="' + literal + '">'));
  assert.equal(convert('**未完了：').plain, '**未完了：');
  assert.equal(convert(String.raw`**項目：\*\*説明`).plain, literal);
  assert.equal(convert('*斜体* **太字** ***両方***').html, '<p><em>斜体</em> <strong>太字</strong> <em><strong>両方</strong></em></p>');
});

test('quotes and dividers use supported formatting and textual fallbacks', () => {
  const result = convert('> **引用**\n> 続き\n\n---\n\n本文');
  assert.equal(result.plain, '> 引用\n> 続き\n\n────────\n\n本文');
  assert.equal(dom(result.html).querySelector('blockquote strong').textContent, '引用');
  assert.equal(dom(result.html).querySelector('hr'), null);
});

test('raw HTML and encoded HTML remain inert visible text', () => {
  const source = '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<svg onload=alert(1)>text</svg>\n\n&lt;img src=x onerror=alert(2)&gt;';
  const result = convert(source);
  assert.equal(dom(result.html).querySelector('script,img,svg'), null);
  assert.match(result.plain, /<script>alert\(1\)<\/script>/);
  assert.match(result.plain, /<img src=x onerror=alert\(2\)>/);
});

test('unsafe and relative URLs become text without discarding labels or destinations', () => {
  const result = convert('[bad](javascript:alert%281%29) [encoded](java&#x73;cript:alert%281%29) [relative](/file) [data](data:text/html,test)');
  assert.equal(dom(result.html).querySelector('a'), null);
  assert.match(result.plain, /relative \(\/file\)/);
  assert.match(result.plain, /encoded \(javascript:alert%281%29\)/);
  assert.equal(result.changes.unsafeLinks, 4);
});

test('link attributes are escaped, even for hostile quote characters', () => {
  const result = convert('[safe](https://example.com/\"onclick=\"evil)');
  const anchor = dom(result.html).querySelector('a');
  assert.ok(anchor);
  assert.deepEqual([...anchor.attributes].map((attribute) => attribute.name), ['href']);
});

test('unsupported syntax remains visible and unfinished input is accepted', () => {
  for (const source of ['$$x^2$$', '[^note]', '```\n# code in progress', '[unfinished', '**unfinished']) {
    const result = convert(source);
    assert.ok(result.plain.length);
  }
  assert.equal(convert('').html, '');
  assert.equal(convert('  \n\n').plain, '');
});
