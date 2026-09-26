import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** 127.0.0.1 で待ち受け、受けたリクエストの数を数える「外部サーバーの代役」。実際のインターネットには出ない。 */
export class Sink {
  readonly url: string;
  private hitCount = 0;
  private readonly server: Server;

  /** 待ち受け済みのサーバーから代役を作る(start() から使う)。 */
  private constructor(server: Server, port: number) {
    this.server = server;
    this.url = `http://127.0.0.1:${port}/`;
    server.on('request', (_request, response) => {
      this.hitCount += 1;
      response.end('sink');
    });
  }

  /** 空きポートで待ち受ける代役を起動する。 */
  static async start(): Promise<Sink> {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return new Sink(server, (server.address() as AddressInfo).port);
  }

  /** これまでに受けたリクエストの数。 */
  hits(): number {
    return this.hitCount;
  }

  /** 待ち受けを止める。 */
  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}
