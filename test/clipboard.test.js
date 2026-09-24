import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { copyResult } from '../clipboard.js';

const result = { html: '<p><strong>Title</strong></p>', plain: 'Title\n\n• Item (https://example.com)' };

test('rich copy includes HTML and the complete plain text fallback', async () => {
  let written;
  const window = {
    navigator: { clipboard: { write: async (items) => { written = items[0]; } } },
    ClipboardItem: class { constructor(data) { this.data = data; } },
    Blob,
  };
  await copyResult(result, { window });
  assert.equal(await written.data['text/html'].text(), result.html);
  assert.equal(await written.data['text/plain'].text(), result.plain);
});

test('plain copy only writes readable text, with list markers and URLs', async () => {
  let written;
  await copyResult(result, { rich: false, window: {
    navigator: { clipboard: { writeText: async (value) => { written = value; } } },
  } });
  assert.equal(written, result.plain);
});

for (const rejects of [false, true]) {
  test(`copy event fallback preserves both formats when the API ${rejects ? 'rejects' : 'is absent'}`, async () => {
    const { window } = new JSDOM('<textarea id="editor">original</textarea>');
    const { document } = window;
    document.querySelector('#editor').focus();
    if (rejects) {
      window.ClipboardItem = class {};
      Object.defineProperty(window.navigator, 'clipboard', { value: { write: async () => { throw new Error('Denied'); } } });
    }
    const data = {};
    document.execCommand = () => {
      const event = new window.Event('copy', { cancelable: true });
      event.clipboardData = { setData: (type, value) => { data[type] = value; } };
      document.dispatchEvent(event);
      return event.defaultPrevented;
    };
    await copyResult(result, { window });
    assert.deepEqual(data, { 'text/plain': result.plain, 'text/html': result.html });
    assert.equal(document.activeElement.id, 'editor');
    assert.equal(document.querySelectorAll('textarea').length, 1);
  });
}

test('failed fallback throws instead of claiming success and removes its temporary element', async () => {
  const { window } = new JSDOM('<p>Original</p>');
  window.document.execCommand = () => false;
  await assert.rejects(copyResult(result, { window }), /Clipboard copy failed/);
  assert.equal(window.document.querySelector('textarea'), null);
});
