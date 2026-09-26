import { join } from 'node:path';
import { FIXTURE_DIR } from '../../tests/fixtures/write.ts';

/** テスト用のファイル(tests/fixtures/ の下。E2E の開始時に生成される)の、絶対パスを返す。 */
export function fixturePath(name: string): string {
  return join(FIXTURE_DIR, name);
}
