import { mkdir, readdir, rm } from 'node:fs/promises';
import { writeFixtures } from '../tests/fixtures/write.ts';
import { runDirName, runsToDelete } from './helpers/artifacts.ts';

export const SCREENSHOT_ROOT = 'e2e-artifacts/screenshots';
const KEEP_RUNS = 10;

/** 古い実行のディレクトリを、今回の分を含めて KEEP_RUNS 個になるように削除する。 */
async function pruneOldRuns(root: string): Promise<void> {
  const names = await readdir(root).catch(() => [] as string[]);
  for (const name of runsToDelete(names, KEEP_RUNS - 1)) {
    await rm(`${root}/${name}`, { recursive: true, force: true });
  }
}

/** 全テストの開始前に、テスト用 PDF を生成し(git 管理外のため)、今回の実行ディレクトリを作り、古い実行を整理する。 */
export default async function globalSetup(): Promise<void> {
  await writeFixtures();
  await pruneOldRuns(SCREENSHOT_ROOT);
  const runId = runDirName(new Date());
  process.env.E2E_RUN_ID = runId;
  await mkdir(`${SCREENSHOT_ROOT}/${runId}`, { recursive: true });
}
