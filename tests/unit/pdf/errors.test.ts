import { describe, expect, it } from 'vitest';
import { OpenFailure } from '../../../src/core/controller.ts';
import { toOpenFailure } from '../../../src/pdf/errors.ts';

/** 指定した名前の例外を作る(pdf.js の例外は、name で種類を判別できる)。 */
function named(name: string): Error {
  const error = new Error(`${name} occurred`);
  error.name = name;
  return error;
}

describe('toOpenFailure(pdf.js の例外を、画面に出す 2 種類の失敗に分ける)', () => {
  it('PasswordException は、パスワード付き(encrypted)', () => {
    expect(toOpenFailure(named('PasswordException')).kind).toBe('encrypted');
  });

  it.each(['InvalidPDFException', 'FormatError', 'MissingPDFException', 'UnknownErrorException', 'Error'])(
    '%s は、壊れているか PDF ではない(invalid)',
    (name) => {
      expect(toOpenFailure(named(name)).kind).toBe('invalid');
    },
  );

  it.each([['文字列', 'oops'], ['undefined', undefined], ['null', null], ['name のないオブジェクト', {}]])(
    '例外でないもの(%s)も、invalid にする',
    (_label, value) => {
      expect(toOpenFailure(value).kind).toBe('invalid');
    },
  );

  it('OpenFailure を返し、元の例外を cause に持つ', () => {
    const original = named('PasswordException');
    const failure = toOpenFailure(original);
    expect(failure).toBeInstanceOf(OpenFailure);
    expect(failure.cause).toBe(original);
  });
});
