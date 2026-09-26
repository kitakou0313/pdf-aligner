/**
 * 画面の密度(devicePixelRatio)が変わったとき(ブラウザのズーム、密度の違う画面への移動)に、
 * 新しい値を渡して onChange を呼ぶ。密度の変化は、今の値を条件にした matchMedia の「一致の変化」で検知し、
 * 変化するたびに、新しい密度を条件にして監視し直す。
 */
export function watchDevicePixelRatio(onChange: (dpr: number) => void): void {
  const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  query.addEventListener(
    'change',
    () => {
      onChange(window.devicePixelRatio);
      watchDevicePixelRatio(onChange);
    },
    { once: true },
  );
}
