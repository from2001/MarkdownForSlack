import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export const deployFiles = JSON.parse(await readFile(new URL('./deploy-files.json', import.meta.url), 'utf8'));

/** Stage only explicitly approved public assets, never source tooling or secrets. */
export async function prepareDeployment(destination = resolve(root, '.deploy')) {
  await rm(destination, { recursive: true, force: true });
  for (const file of deployFiles) {
    const target = resolve(destination, file);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resolve(root, file), target);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareDeployment();
  console.log(`Prepared ${deployFiles.length} public assets in .deploy/`);
}
