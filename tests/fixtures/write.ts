import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixtures } from './build.ts';

/** 既定の書き出し先(このファイルと同じディレクトリ)。 */
export const FIXTURE_DIR = fileURLToPath(new URL('.', import.meta.url));

/** 全フィクスチャを生成して dir に書き出し(なければ作り、既存は上書きする)、書き出したファイル名を返す。 */
export async function writeFixtures(dir: string = FIXTURE_DIR): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const fixtures = await buildFixtures();
  await Promise.all([...fixtures].map(([name, bytes]) => writeFile(join(dir, name), bytes)));
  return [...fixtures.keys()];
}
