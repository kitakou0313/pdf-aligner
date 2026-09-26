import { writeFile } from 'node:fs/promises';
import { buildFixtures } from './build.ts';

/** 生成した全フィクスチャを、このディレクトリに書き出す(npm run fixtures)。 */
async function main(): Promise<void> {
  for (const [name, bytes] of await buildFixtures()) {
    await writeFile(new URL(name, import.meta.url), bytes);
    console.log(`${name}  ${bytes.length} bytes`);
  }
}

await main();
