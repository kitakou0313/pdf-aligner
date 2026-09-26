import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import jsdoc from 'eslint-plugin-jsdoc';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import maxLinesExceptTests from './tools/eslint/max-lines-per-function-except-tests.mjs';

// 説明文に、ひらがな・カタカナ・漢字のいずれかを 1 文字以上含めることを求める
const JAPANESE = '[\\s\\S]*[\\u3040-\\u30ff\\u3400-\\u9fff][\\s\\S]*';
const FUNCTION_KINDS = {
  FunctionDeclaration: true,
  ArrowFunctionExpression: true,
  FunctionExpression: true,
  MethodDefinition: true,
};
const DEPENDENCY_MESSAGE = '依存の向きは view → core ← pdf に限る。core は他の層に依存しない。';

/** 指定した import を禁止する no-restricted-imports の設定を作る。 */
function forbidImports(patterns) {
  const group = { group: patterns, message: DEPENDENCY_MESSAGE };
  return { 'no-restricted-imports': ['error', { patterns: [group] }] };
}

export default defineConfig(
  {
    ignores: ['dist/**', 'coverage/**', 'e2e-artifacts/**', 'test-results/**', 'playwright-report/**'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts,mjs}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { jsdoc, local: { rules: { 'max-lines-per-function': maxLinesExceptTests } } },
    rules: {
      'local/max-lines-per-function': ['error', { max: 12, skipBlankLines: true, skipComments: true }],
      'jsdoc/require-jsdoc': ['error', { require: FUNCTION_KINDS }],
      'jsdoc/require-description': 'error',
      'jsdoc/match-description': ['error', { matchDescription: JAPANESE }],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: forbidImports(['**/view/**', '**/pdf/**', 'pdfjs-dist', 'pdfjs-dist/**', 'node:*']),
  },
  {
    files: ['src/view/**/*.ts'],
    rules: forbidImports(['**/pdf/**', 'pdfjs-dist', 'pdfjs-dist/**', 'node:*']),
  },
  {
    files: ['src/pdf/**/*.ts'],
    rules: forbidImports(['**/view/**', 'node:*']),
  },
);
