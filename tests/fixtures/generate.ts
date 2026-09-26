import { writeFixtures } from './write.ts';

/** 全フィクスチャをこのディレクトリに書き出し、名前を表示する(npm run fixtures)。 */
async function main(): Promise<void> {
  for (const name of await writeFixtures()) console.log(name);
}

await main();
