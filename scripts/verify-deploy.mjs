import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deployFiles } from './prepare-deploy.mjs';

export const productionUrl = 'https://yamaguchimasahiro.com/web/MarkdownForSlack/';
const digest = (value) => createHash('sha256').update(value).digest('hex');
const root = fileURLToPath(new URL('../.deploy/', import.meta.url));

/** Check actual public bytes and module MIME types, rather than trusting an upload exit code. */
export async function verifyDeployment({ baseUrl = productionUrl, directory = root, fetcher = fetch } = {}) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:') throw new Error('Deployment verification requires HTTPS');
  for (const file of deployFiles) {
    const url = new URL(file, base);
    url.searchParams.set('deploy-check', process.env.GITHUB_SHA || String(Date.now()));
    const response = await fetcher(url, {
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
    const mime = response.headers.get('content-type') || '';
    if (file.endsWith('.js') && !/^(text|application)\/(javascript|ecmascript)(;|$)/i.test(mime)) {
      throw new Error(`${file}: expected a JavaScript MIME type, received ${mime}`);
    }
    const actual = new Uint8Array(await response.arrayBuffer());
    const expected = await readFile(resolve(directory, file));
    if (digest(actual) !== digest(expected)) throw new Error(`${file}: public content does not match this deployment`);
    console.log(`Verified ${file}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let verified = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await verifyDeployment();
      verified = true;
      break;
    } catch (error) {
      console.error(`Verification attempt ${attempt}/3: ${error.message}`);
      if (attempt < 3) await new Promise((done) => setTimeout(done, 5000));
    }
  }
  if (!verified) process.exitCode = 1;
}
