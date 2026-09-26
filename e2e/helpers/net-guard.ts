const SAFE_PROTOCOLS = new Set(['data:', 'about:']);
const LOCAL_HOSTNAME = 'localhost';

/** 解釈済みの URL が内部を指すかを判定する(blob: は、中に入っている元の URL で判断する)。 */
function isInternalUrl(url: URL): boolean {
  if (SAFE_PROTOCOLS.has(url.protocol)) return true;
  if (url.protocol === 'blob:') return isInternal(url.pathname);
  return url.hostname === LOCAL_HOSTNAME;
}

/** 文字列の URL が、localhost かネットワークを使わないもの(data / about / blob)を指すかを判定する。 */
function isInternal(raw: string): boolean {
  try {
    return isInternalUrl(new URL(raw));
  } catch {
    return false;
  }
}

/** localhost 以外への通信を指す URL だけを、順序を保って返す。解釈できない URL は外部として扱う。 */
export function externalUrls(urls: readonly string[]): string[] {
  return urls.filter((url) => !isInternal(url));
}
