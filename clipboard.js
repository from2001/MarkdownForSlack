/** Copy a captured conversion result, with a synchronous event-based fallback. */
export async function copyResult(result, { rich = true, window = globalThis.window } = {}) {
  const { navigator, document, ClipboardItem, Blob } = window;
  try {
    if (rich && navigator.clipboard?.write && ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([result.html], { type: 'text/html' }),
        'text/plain': new Blob([result.plain], { type: 'text/plain' }),
      })]);
      return;
    }
    if (!rich && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(result.plain);
      return;
    }
  } catch {
    // Some browsers reject the asynchronous API but allow a copy event.
  }

  const activeElement = document.activeElement;
  const selection = window.getSelection();
  const savedRanges = Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange());
  const field = document.createElement('textarea');
  field.value = result.plain;
  field.setAttribute('aria-hidden', 'true');
  field.style.cssText = 'position:fixed;left:-9999px;top:0;';
  let populated = false;
  const onCopy = (event) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData('text/plain', result.plain);
    if (rich) event.clipboardData.setData('text/html', result.html);
    event.preventDefault();
    populated = true;
  };
  document.body.append(field);
  field.select();
  document.addEventListener('copy', onCopy);
  try {
    if (!document.execCommand('copy') || !populated) throw new Error('Clipboard copy failed');
  } finally {
    document.removeEventListener('copy', onCopy);
    field.remove();
    activeElement?.focus({ preventScroll: true });
    selection.removeAllRanges();
    savedRanges.forEach((range) => selection.addRange(range));
  }
}
