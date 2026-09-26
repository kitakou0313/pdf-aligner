import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { FIXTURE_NAMES } from '../tests/fixtures/build.ts';
import { FIXTURE_DIR } from '../tests/fixtures/write.ts';
import { expect, test } from './helpers/fixtures.ts';

test('テスト用 PDF が、E2E の開始時に生成されている(git 管理外なので)', async () => {
  for (const name of FIXTURE_NAMES) {
    await expect(access(join(FIXTURE_DIR, name)), name).resolves.toBeUndefined();
  }
});
