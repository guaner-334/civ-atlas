/**
 * 读世界的代码分版本(src/gen/readers/):按版本取到对的代码,认不出的版本明确报错,
 * 改算法时把旧代码留一份这条路走得通(这里用假的「第 2 版」走;真的打包结果要看构建产物,见 src/gen/readers/index.ts 的步骤)。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ownersAt } from '../src/gen/civ/engine/timeline';
import { populationAt } from '../src/gen/civ/growth';
import { faithAt } from '../src/gen/civ/religion';
import { rasterize } from '../src/gen/raster';
import { rasterizeWindow, zoomSource } from '../src/gen/rasterWindow';
import { FIRST_READERS, READER_VERSIONS, UnknownReaderError, queryReader, readersFor, terrainReader } from '../src/gen/readers';
import { readerBook } from '../src/gen/readers/versions';
import { frozenText, readerFiles, type ReadFile } from '../scripts/lib/readerCopy';
import { readSample, readSamples } from './lib/savedWorlds';

describe('按版本取读取代码', () => {
  it('当前版本取到的就是现有的代码', async () => {
    const t = await terrainReader(READER_VERSIONS.terrain);
    expect(t.rasterize).toBe(rasterize);
    expect(t.rasterizeWindow).toBe(rasterizeWindow);
    expect(t.zoomSource).toBe(zoomSource);
    const q = await queryReader(READER_VERSIONS.query);
    expect(q.ownersAt).toBe(ownersAt);
    expect(q.faithAt).toBe(faithAt);
    expect(q.populationAt).toBe(populationAt);
  });

  it('当前版本不用等:下一条消息来之前就拿到了', async () => {
    let got = false;
    void terrainReader(READER_VERSIONS.terrain).then(() => (got = true));
    await new Promise<void>((r) => queueMicrotask(r));
    await new Promise<void>((r) => queueMicrotask(r));
    expect(got).toBe(true);
  });

  it('没记版本的老世界是第 1 版', () => {
    expect(FIRST_READERS).toEqual({ terrain: 1, query: 1 });
  });

  it('readersFor 两份一起取', async () => {
    const r = await readersFor(READER_VERSIONS);
    expect(r.terrain.rasterize).toBe(rasterize);
    expect(r.query.ownersAt).toBe(ownersAt);
  });

  it('比软件新的版本:明确报错,说要更新软件', async () => {
    const e = await terrainReader(READER_VERSIONS.terrain + 1).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UnknownReaderError);
    expect(e).toMatchObject({ kind: 'terrain', version: READER_VERSIONS.terrain + 1, needsUpdate: true });
    expect((e as Error).message).toContain('更新软件');
  });

  it.each([[0], [-1], [1.5], [NaN], [Infinity], ['1'], [''], [null], [undefined], ['constructor'], ['__proto__'], [{}], [[1]], [true]])('版本号不对(%j):明确报错,不是更新软件能解决的', async (v) => {
    const e = await queryReader(v).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UnknownReaderError);
    expect(e).toMatchObject({ kind: 'query', needsUpdate: false });
  });

  it('样本按它记的版本读:记着软件没有的版本就读不了', async () => {
    const [s] = readSamples();
    expect(s.readers).toEqual(FIRST_READERS);
    await expect(readSample({ ...s, readers: { ...s.readers, terrain: READER_VERSIONS.terrain + 1 } })).rejects.toBeInstanceOf(UnknownReaderError);
    await expect(readSample({ ...s, readers: { ...s.readers, query: READER_VERSIONS.query + 1 } })).rejects.toBeInstanceOf(UnknownReaderError);
  });
});

describe('假的第 2 版:算法改了、旧的留一份', () => {
  type Code = { whichCode: string; seaLevel: (elev: number) => number };
  const now: Code = { whichCode: 'now', seaLevel: (elev) => elev };
  const oldCode = () => import('./fixtures/fake-old-reader') as Promise<Code>;

  it('按版本取到不同的代码,结果不一样', async () => {
    const book = readerBook<Code>('terrain', 2, now, { 1: oldCode });
    const [v1, v2] = await Promise.all([book(1), book(2)]);
    expect(v1.whichCode).toBe('old');
    expect(v2.whichCode).toBe('now');
    expect(v1.seaLevel(100)).not.toBe(v2.seaLevel(100));
  });

  it('只有用到老版本才下载,下载过的不再下载', async () => {
    const load = vi.fn(oldCode);
    const book = readerBook<Code>('terrain', 2, now, { 1: load });
    await book(2);
    expect(load).not.toHaveBeenCalled();
    const [a, b] = await Promise.all([book(1), book(1)]);
    await book(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('下载失败不算认不出版本,再要一次会重新下载', async () => {
    const load = vi.fn<() => Promise<Code>>().mockRejectedValueOnce(new TypeError('下载失败')).mockImplementation(oldCode);
    const book = readerBook<Code>('terrain', 2, now, { 1: load });
    const e = await book(1).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(TypeError);
    expect(e).not.toBeInstanceOf(UnknownReaderError);
    expect((await book(1)).whichCode).toBe('old');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('没留下来的版本还是认不出', async () => {
    const book = readerBook<Code>('terrain', 3, now, { 1: oldCode });
    await expect(book(2)).rejects.toBeInstanceOf(UnknownReaderError);
    await expect(book(4)).rejects.toMatchObject({ needsUpdate: true });
  });
});

describe('留存底要复制的文件', () => {
  const read: ReadFile = (path) => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  };

  it('读取清单用到的代码都复制到,而且都是纯计算的代码', () => {
    const terrain = readerFiles(read, 'src/gen/readers/terrainCode.ts');
    for (const f of ['raster', 'rasterWindow', 'rasterPatch', 'gully', 'valleys', 'pixelDrain', 'creeks', 'seaice', 'wetland', 'noise', 'biomes', 'estuary', 'riverGeometry', 'util']) expect(terrain).toContain(`src/gen/${f}.ts`);
    const query = readerFiles(read, 'src/gen/readers/queryCode.ts');
    for (const f of ['civ/engine/timeline', 'civ/growth', 'civ/religion', 'civ/development', 'civ/control', 'civ/ideology', 'civ/story/peopleInfo']) expect(query).toContain(`src/gen/${f}.ts`);
  });

  it('读取代码引到外面的目录(画图、界面)时留不了存底', () => {
    const files: Record<string, string> = { 'src/gen/a.ts': "import { b } from '../ui/b';\nexport const a = b;\n", 'src/ui/b.ts': 'export const b = 1;\n' };
    expect(() => readerFiles((p) => files[p] ?? null, 'src/gen/a.ts')).toThrow('src/ui/b.ts');
  });

  it('运行要用的文件都复制,只为类型引的不复制,路径改成指向原文件', () => {
    const files: Record<string, string> = {
      'src/gen/a.ts': "import { b } from './b';\nimport type { T } from './t';\nimport { type U } from './u';\nexport type V = import('./v').V;\nexport const a: T | U | V = b;\n",
      'src/gen/b.ts': "import type { A } from './a';\nexport const b = 1;\nexport type B = A;\n",
      'src/gen/t.ts': 'export type T = number;\n',
      'src/gen/u.ts': 'export type U = number;\n',
      'src/gen/v.ts': 'export type V = number;\n',
    };
    const get: ReadFile = (p) => files[p] ?? null;
    const list = readerFiles(get, 'src/gen/a.ts');
    expect(list).toEqual(['src/gen/a.ts', 'src/gen/b.ts']);
    const a = frozenText(get, 'src/gen/a.ts', new Set(list), 'src/gen/readers/terrain/v1', 'src/gen', '只读');
    expect(a).toContain("import { b } from './b';");
    expect(a).toContain("import type { T } from '../../../t';");
    expect(a).toContain("import { type U } from '../../../u';");
    expect(a).toContain("import('../../../v').V");
    expect(a.split('\n').slice(0, 2)).toEqual(['// @ts-nocheck', '// 只读']);
    // 类型引的文件在存底里:路径不用改
    expect(frozenText(get, 'src/gen/b.ts', new Set(list), 'src/gen/readers/terrain/v1', 'src/gen', '只读')).toContain("from './a';");
  });
});
