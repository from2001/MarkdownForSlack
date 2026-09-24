import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deployFiles, prepareDeployment } from '../scripts/prepare-deploy.mjs';
import { verifyDeployment } from '../scripts/verify-deploy.mjs';

test('deployment package contains only the public site and preserves its file layout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'markdown-deploy-'));
  try {
    await prepareDeployment(directory);
    const entries = await readdir(directory, { recursive: true });
    assert.deepEqual(entries.filter((entry) => entry !== 'vendor').sort(), [...deployFiles].sort());
    assert.match(await readFile(join(directory, 'index.html'), 'utf8'), /src="\.\/app.js"/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('public verification checks every file and rejects stale data, HTTP errors and incorrect module MIME types', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'markdown-deploy-'));
  try {
    await prepareDeployment(directory);
    const fetched = [];
    const fetcher = async (url) => {
      const file = url.pathname.replace('/web/MarkdownForSlack/', '');
      fetched.push(file);
      return new Response(await readFile(join(directory, file)), {
        headers: { 'content-type': file.endsWith('.js') ? 'text/javascript; charset=UTF-8' : 'text/plain' },
      });
    };
    await verifyDeployment({ directory, fetcher });
    assert.deepEqual(fetched, deployFiles);
    await assert.rejects(verifyDeployment({ directory, fetcher: async () => new Response('old') }), /does not match/);
    await assert.rejects(verifyDeployment({ directory, fetcher: async () => new Response('missing', { status: 404 }) }), /HTTP 404/);
    await assert.rejects(verifyDeployment({ directory, fetcher: async (url) => {
      const response = await fetcher(url);
      response.headers.set('content-type', 'text/html');
      return response;
    } }), /JavaScript MIME type/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
