import { builtinRules } from 'eslint/use-at-your-own-risk';

const baseRule = builtinRules.get('max-lines-per-function');
const TEST_FUNCTIONS = /^(describe|it|test|suite|before(Each|All)|after(Each|All))$/;

/** 呼び出しの callee から、先頭の識別子名を取り出す(`test.describe` なら `test`)。 */
function rootName(callee) {
  if (callee.type === 'MemberExpression') return rootName(callee.object);
  return callee.type === 'Identifier' ? callee.name : '';
}

/** 関数が、describe / it / test などの呼び出しに渡されたコールバックかを判定する。 */
function isTestCallback(node) {
  const parent = node?.parent;
  if (parent?.type !== 'CallExpression') return false;
  return parent.arguments.includes(node) && TEST_FUNCTIONS.test(rootName(parent.callee));
}

/** 標準の max-lines-per-function を包み、テストのコールバックへの指摘だけを取り除く。 */
function create(context) {
  /** テストのコールバックへの指摘は捨て、それ以外を本来の report に渡す。 */
  const report = (descriptor) => {
    if (!isTestCallback(descriptor.node)) context.report(descriptor);
  };
  // prototype を引き継ぎつつ report だけを差し替える(凍結された context には代入できないため defineProperty 方式)
  return baseRule.create(Object.create(context, { report: { value: report } }));
}

export default { meta: baseRule.meta, create };
