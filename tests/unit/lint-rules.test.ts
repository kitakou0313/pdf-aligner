import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ overrideConfigFile: 'eslint.config.mjs' });
const LONG = 'local/max-lines-per-function';
const JSDOC = 'jsdoc/require-jsdoc';

/** ソースを指定したパスのファイルとして lint し、検出された規則名の一覧を返す。 */
async function ruleIdsFor(source: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'parse-error');
}

/** 本体が n 行の文で、日本語の JSDoc が付いた関数宣言のソースを作る。 */
function fnWithBody(n: number, name = 'f'): string {
  const body = Array.from({ length: n }, (_, i) => `  void ${i};`).join('\n');
  return `/** 値を並べる。 */\nexport function ${name}() {\n${body}\n}\n`;
}

describe('関数の長さ(12 行まで。空行とコメント行は数えない)', () => {
  it('宣言行と閉じ括弧を含めて 12 行の関数は許可する', async () => {
    expect(await ruleIdsFor(fnWithBody(10), 'src/core/a.ts')).not.toContain(LONG);
  });

  it('13 行の関数は違反にする', async () => {
    expect(await ruleIdsFor(fnWithBody(11), 'src/core/a.ts')).toContain(LONG);
  });

  it('空行とコメント行を足しても、行数に数えない', async () => {
    const padded = fnWithBody(10).replace('  void 0;', '  // 補足\n\n  void 0;');
    expect(await ruleIdsFor(padded, 'src/core/a.ts')).not.toContain(LONG);
  });

  it('describe / it のコールバックは、長くても許可する', async () => {
    const body = Array.from({ length: 30 }, (_, i) => `    void ${i};`).join('\n');
    const src = `describe('x', () => {\n  it('y', () => {\n${body}\n  });\n});\n`;
    expect(await ruleIdsFor(src, 'tests/unit/a.test.ts')).not.toContain(LONG);
  });

  it('テストファイル内のヘルパー関数は、長ければ違反にする', async () => {
    expect(await ruleIdsFor(fnWithBody(11), 'tests/unit/a.test.ts')).toContain(LONG);
  });
});

describe('JSDoc の必須化(関数宣言、変数に代入した関数、メソッド)', () => {
  const NO_DOC: [string, string][] = [
    ['関数宣言', 'export function f() { return 1; }\n'],
    ['変数に代入したアロー関数', 'export const f = () => 1;\n'],
    ['クラスのメソッド', '/** 入れ物。 */\nexport class C {\n  m() { return 1; }\n}\n'],
  ];

  it.each(NO_DOC)('%s は、JSDoc がなければ違反にする', async (_name, src) => {
    expect(await ruleIdsFor(src, 'src/core/a.ts')).toContain(JSDOC);
  });

  it('JSDoc があれば許可する', async () => {
    expect(await ruleIdsFor(fnWithBody(1), 'src/core/a.ts')).not.toContain(JSDOC);
  });

  it('インラインのコールバックは、JSDoc がなくても許可する', async () => {
    const src = '/** 二倍にする。 */\nexport function f(xs: number[]) {\n  return xs.map((x) => x * 2);\n}\n';
    expect(await ruleIdsFor(src, 'src/core/a.ts')).not.toContain(JSDOC);
  });

  it('説明が空の JSDoc は違反にする', async () => {
    const src = '/** */\nexport function f() { return 1; }\n';
    expect(await ruleIdsFor(src, 'src/core/a.ts')).toContain('jsdoc/require-description');
  });

  it('日本語を含まない説明は違反にする', async () => {
    const src = '/** Returns one. */\nexport function f() { return 1; }\n';
    expect(await ruleIdsFor(src, 'src/core/a.ts')).toContain('jsdoc/match-description');
  });
});

describe('層の依存の向き(view → core ← pdf)', () => {
  const RESTRICTED = 'no-restricted-imports';
  const FORBIDDEN: [string, string, string][] = [
    ['core', 'src/core/a.ts', "import '../view/toolbar.ts';"],
    ['core', 'src/core/a.ts', "import '../pdf/loader.ts';"],
    ['core', 'src/core/a.ts', "import 'pdfjs-dist';"],
    ['core', 'src/core/a.ts', "import 'node:fs';"],
    ['view', 'src/view/a.ts', "import '../pdf/loader.ts';"],
    ['view', 'src/view/a.ts', "import 'pdfjs-dist/build/pdf.mjs';"],
    ['pdf', 'src/pdf/a.ts', "import '../view/toolbar.ts';"],
  ];
  const ALLOWED: [string, string, string][] = [
    ['view', 'src/view/a.ts', "import '../core/layout.ts';"],
    ['pdf', 'src/pdf/a.ts', "import '../core/compose.ts';"],
    ['pdf', 'src/pdf/a.ts', "import 'pdfjs-dist';"],
    ['main', 'src/main.ts', "import './view/toolbar.ts';\nimport './pdf/loader.ts';"],
  ];

  it.each(FORBIDDEN)('%s からの禁止された import を検出する(%s: %s)', async (_layer, path, src) => {
    expect(await ruleIdsFor(src + '\n', path)).toContain(RESTRICTED);
  });

  it.each(ALLOWED)('%s からの許可された import は通す(%s: %s)', async (_layer, path, src) => {
    expect(await ruleIdsFor(src + '\n', path)).not.toContain(RESTRICTED);
  });
});
