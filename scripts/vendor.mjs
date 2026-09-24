import { copyFile, mkdir } from 'node:fs/promises';

// Keep the deployed app static and independent of third-party CDNs.
await mkdir(new URL('../vendor/', import.meta.url), { recursive: true });
for (const [source, target] of [
  ['lib/marked.esm.js', 'marked.esm.js'],
  ['LICENSE', 'marked.LICENSE'],
]) {
  await copyFile(
    new URL(`../node_modules/marked/${source}`, import.meta.url),
    new URL(`../vendor/${target}`, import.meta.url),
  );
}
