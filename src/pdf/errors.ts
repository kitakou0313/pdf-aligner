import { OpenFailure } from '../core/controller.ts';

/** 例外の name を取り出す(例外でないものは空の文字列)。 */
function nameOf(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
}

/**
 * pdf.js が PDF を開けなかったときの例外を、画面に出す 2 種類の失敗に分ける。
 * パスワード付き(PasswordException)は encrypted、それ以外(壊れている、PDF ではない、原因不明)は invalid。
 */
export function toOpenFailure(error: unknown): OpenFailure {
  const kind = nameOf(error) === 'PasswordException' ? 'encrypted' : 'invalid';
  return new OpenFailure(kind, error);
}
