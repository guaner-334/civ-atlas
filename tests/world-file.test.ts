/**
 * 世界文件:打包再读回、外壳和清单的规矩、三种错分得开、认不出的块原样带着、迁移、乱改文件不卡死。
 * 每一条校验规则各造一个坏值的测试在 tests/world-validate.test.ts,钉住第 1 版的在 tests/world-file-v1.test.ts。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TUNING_CALC } from '../src/gen/civ/tuning';
import { makePart, partLimit, sha256 } from '../src/gen/snapshot';
import { mulberry32 } from '../src/gen/util';
import { checkWorldFile, checkWorldFileInWorker, type WorldCheckRequest, type WorldCheckResult, type WorldCheckWorker } from '../src/gen/worldCheck';
import { openWorldFile, packWorldFile, readWorldContent, rewriteWorldFile, type PackInput, type WorldEras } from '../src/gen/worldFile';
import { WORLD_FILE_EXT, WorldFileError, asWorldFileError, type WorldFileErrorKind } from '../src/gen/worldFormat';
import { MIGRATIONS, currentSchema, migratePart, type MigrationTable } from '../src/gen/worldMigrate';
import { MANIFEST_MAX_BYTES, parseManifest, worldPartLimit } from '../src/gen/worldValidate';
import { ZIP_LOCAL_MAX_BYTES, ZIP_UPLOAD_MAX_BYTES, parseZip, writeZip, type ZipInput } from '../src/gen/zipStore';
import { READERS, bytesOf, makeSample, tinyJpeg } from './lib/worldFileSample';

/* eslint-disable @typescript-eslint/no-explicit-any */

const OPEN = { readers: READERS };
const text = (s: string) => new TextEncoder().encode(s);

let sample: PackInput & { eras: WorldEras };
let good: Uint8Array;
let goodManifest: any;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'world-file-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

beforeAll(async () => {
  sample = makeSample();
  good = await bytesOf(await packWorldFile(sample));
  goodManifest = JSON.parse(new TextDecoder().decode(parseZip(good, ZIP_LOCAL_MAX_BYTES).find((e) => e.name === 'manifest.json')!.data));
}, 120_000);

/** 按原样拆开这个文件,改一改清单、条目,再装回去 */
async function repack(change: (m: any, entries: ZipInput[]) => void): Promise<Uint8Array> {
  const entries = parseZip(good, ZIP_LOCAL_MAX_BYTES).filter((e) => e.name !== 'manifest.json') as ZipInput[];
  const m = structuredClone(goodManifest);
  change(m, entries);
  return bytesOf(await writeZip([{ name: 'manifest.json', data: text(JSON.stringify(m)) }, ...entries], ZIP_LOCAL_MAX_BYTES));
}

/** 这件事应该报这一种错 */
async function expectKind(run: () => unknown, kind: WorldFileErrorKind, hint?: string) {
  let err: unknown;
  try {
    await run();
  } catch (e) {
    err = e;
  }
  expect(err, hint ? `应该报错:${hint}` : '应该报错').toBeInstanceOf(WorldFileError);
  expect((err as WorldFileError).kind, `${hint ?? ''} ${(err as Error).message}`).toBe(kind);
}

const manifestOf = (change: (m: any) => void) => {
  const m = structuredClone(goodManifest);
  change(m);
  return text(JSON.stringify(m));
};

describe('世界文件:打包再读回', () => {
  it('打包 → 读回 → 校验 → 和原来逐项相等', async () => {
    const c = await readWorldContent(await openWorldFile(good, OPEN));
    expect(isDeepStrictEqual(c.map, { ...sample.map, history: [] })).toBe(true);
    expect(isDeepStrictEqual(c.eras, sample.eras)).toBe(true);
    expect(isDeepStrictEqual(c.civ, sample.civ)).toBe(true);
    expect(isDeepStrictEqual(c.chronicle, sample.chronicle)).toBe(true);
    expect(isDeepStrictEqual(c.flags, sample.flags)).toBe(true);
    expect(c.author).toEqual(sample.author);
    expect(c.thumb).toEqual(sample.thumb);
    expect(c.save.title).toBe('九州大陆');
    expect(c.save.edits.names).toEqual(sample.recipe.edits.names);
    expect(c.skipped).toEqual([]);
  }, 60_000);

  it('清单的字段和块的路径', async () => {
    const { manifest } = await openWorldFile(good, OPEN);
    expect(WORLD_FILE_EXT).toBe('.civworld');
    expect(manifest.app).toBe('文明与地图');
    expect(manifest.kind).toBe('world');
    expect(manifest.format).toBe(1);
    expect(manifest.id).toBe('wsample');
    expect(manifest.title).toBe('九州大陆');
    expect(manifest.made).toEqual(sample.made);
    expect(manifest.readers).toEqual(READERS);
    expect(manifest.plugins).toEqual([]);
    expect(manifest.revision).toEqual({ n: 1 });
    expect(manifest.recipe).toEqual(sample.recipe);
    expect(manifest.parts.map((p) => [p.name, p.file, p.schema, p.zip, p.need])).toEqual([
      ['map', 'parts/map.gz', 1, 'gzip', 'view'],
      ['eras', 'parts/eras.gz', 1, 'gzip', 'view'],
      ['civ', 'parts/civ.gz', 1, 'gzip', 'view'],
      ['chronicle', 'parts/chronicle.gz', 2, 'gzip', 'view'],
      ['flags', 'parts/flags.gz', 1, 'gzip', 'view'],
      ['author', 'parts/author.gz', 1, 'gzip', 'extra'],
      ['thumb', 'parts/thumb.jpg', 1, 'none', 'extra'],
    ]);
    // 块的指纹是解压后字节的 SHA-256,和存原件时一样
    const civ = await makePart('civ', sample.civ);
    expect(manifest.parts.find((p) => p.name === 'civ')!.sum).toBe(civ.sum);
    expect(manifest.parts.find((p) => p.name === 'thumb')!.sum).toBe(await sha256(sample.thumb!));
  });

  it('没有地形大事、作者内容、封面的世界:这几块不写,读回是空的', async () => {
    const f = await bytesOf(await packWorldFile({ ...sample, eras: { baseKey: 'base', eras: [] }, author: null, thumb: null }));
    const opened = await openWorldFile(f, OPEN);
    expect(opened.manifest.parts.map((p) => p.name)).toEqual(['map', 'civ', 'chronicle', 'flags']);
    // 这里只看打包;历史是带地形大事推的,校验在 validateCiv 那边单独试
    expect([...opened.bytes.keys()]).toEqual(['map', 'civ', 'chronicle', 'flags']);
  });

  it('形成过程的回放不存;各段世界不带网格', async () => {
    const f = await bytesOf(await packWorldFile({ ...sample, map: { ...sample.map, history: [new Float32Array(sample.map.mesh.n)] }, eras: { baseKey: 'b', eras: sample.eras.eras.map((e) => ({ key: e.key, world: { ...e.world, mesh: sample.map.mesh } as any })) } }));
    const c = await readWorldContent(await openWorldFile(f, OPEN));
    expect(c.map.history).toEqual([]);
    expect('mesh' in c.eras!.eras[0].world).toBe(false);
  }, 30_000);

  it('写出来的文件能被 unzip -t 验证,解压软件里看得到清单', async () => {
    const has = spawnSync('unzip', ['--help'], { stdio: 'ignore' }).error === undefined;
    if (!has) return;
    const file = path.join(tmp, `世界${WORLD_FILE_EXT}`);
    fs.writeFileSync(file, good);
    const t = spawnSync('unzip', ['-t', file], { encoding: 'utf8' });
    expect(t.status, t.stdout + t.stderr).toBe(0);
    expect(t.stdout).toContain('No errors detected');
    const p = spawnSync('unzip', ['-p', file, 'manifest.json'], { encoding: 'utf8', maxBuffer: 1 << 24 });
    expect(JSON.parse(p.stdout).title).toBe('九州大陆');
  });

  it('上传的上限和本机的上限分开:调用方传多少算多少', async () => {
    await expect(packWorldFile({ ...sample, maxBytes: 1000 })).rejects.toThrow('太大');
    await expectKind(() => openWorldFile(good, { ...OPEN, maxBytes: 1000 }), 'broken', '超过调用方给的上限');
    await expectKind(() => openWorldFile(new Blob([good]), { ...OPEN, maxBytes: 1000 }), 'broken', 'Blob 也一样');
    expect((await openWorldFile(new Blob([good]), { ...OPEN, maxBytes: ZIP_UPLOAD_MAX_BYTES })).manifest.id).toBe('wsample');
  });

  it('各块解压的上限跟着文件的上限走:传上服务器照表,本机只防撑爆内存', async () => {
    expect(worldPartLimit('civ', ZIP_UPLOAD_MAX_BYTES)).toBe(partLimit('civ'));
    expect(worldPartLimit('civ')).toBe(1e9);
    expect(worldPartLimit('civ', ZIP_LOCAL_MAX_BYTES)).toBe(1e9);
    // 封面是一张小图,哪儿都照表
    expect(worldPartLimit('thumb')).toBe(partLimit('thumb'));
    // 本机的世界可以比表大(陆地多的世界历史那一块就超),传上服务器的不行
    const big = manifestOf((m) => (m.parts.find((p: any) => p.name === 'civ').bytes = partLimit('civ') + 1));
    expect(parseManifest(big, OPEN).id).toBe('wsample');
    expect(() => parseManifest(big, { ...OPEN, maxBytes: ZIP_UPLOAD_MAX_BYTES })).toThrow('超过上限');
    const tooBig = manifestOf((m) => (m.parts.find((p: any) => p.name === 'civ').bytes = 1e9 + 1));
    expect(() => parseManifest(tooBig, OPEN)).toThrow('超过上限');
    // 读的时候也按这个算:传上服务器的说好的字节数超表就不解
    await expectKind(async () => readWorldContent(await openWorldFile(await repack((m) => (m.parts.find((p: any) => p.name === 'author').bytes = partLimit('author') + 1)), { ...OPEN, maxBytes: ZIP_UPLOAD_MAX_BYTES })), 'broken', '超表');
  }, 30_000);

  it('配方里开发环境的 http 出处写进文件时去掉,别的不动', async () => {
    const recipe = { ...sample.recipe, origin: { title: 'x', url: 'http://localhost:5173/s/abcd' } };
    const { manifest } = await openWorldFile(await bytesOf(await packWorldFile({ ...sample, recipe })), OPEN);
    expect(manifest.recipe.origin).toBeUndefined();
    expect(manifest.recipe.title).toBe(sample.recipe.title);
  });

  it('清单不合规矩的东西写不进文件(写得出来的就读得回来)', async () => {
    await expect(packWorldFile({ ...sample, id: '' })).rejects.toThrow();
    await expect(packWorldFile({ ...sample, plugins: [{ id: 'A B', version: '1', sum: 'x', role: 'sim' }] })).rejects.toThrow();
    await expect(packWorldFile({ ...sample, extras: [{ name: 'civ', schema: 1, value: 1 }] })).rejects.toThrow();
    await expect(packWorldFile({ ...sample, extras: [{ name: '../evil', schema: 1, value: 1 }] })).rejects.toThrow();
  });
});

describe('世界文件:三种错分得开', () => {
  const NEWER: [string, (m: any) => void][] = [
    ['format 比软件新(别的字段都变了也一样)', (m) => Object.assign(Object.keys(m).reduce((o: any, k) => (delete o[k], o), m), { app: '文明与地图', format: 2 })],
    ['kind 认不出', (m) => (m.kind = 'seed')],
    ['读取规则比软件新', (m) => (m.readers.terrain = 2)],
    ['新的读取规则', (m) => (m.readers.weather = 1)],
    ['看世界必须的块比软件新', (m) => (m.parts.find((p: any) => p.name === 'civ').schema = 2)],
    ['看世界必须的块认不出', (m) => m.parts.push({ name: 'magic', file: 'parts/magic.gz', schema: 1, sum: 'a'.repeat(64), bytes: 1, zip: 'gzip', need: 'view' })],
    ['看世界必须的块压缩方式认不出', (m) => (m.parts.find((p: any) => p.name === 'civ').zip = 'zstd')],
    ['配方的格式比软件新', (m) => (m.recipe.format = 99)],
    ['配方的规则换算比软件新', (m) => (m.recipe = { ...m.recipe, format: 4, edits: { ...m.recipe.edits, rules: { id: 'r1', name: '新规则', version: 1, values: { 'war.odds': 2 }, calc: TUNING_CALC + 1 } } })],
  ];
  it.each(NEWER)('要更新软件:%s', (_, change) => {
    expect(() => parseManifest(manifestOf(change), OPEN)).toThrow(WorldFileError);
    try {
      parseManifest(manifestOf(change), OPEN);
    } catch (e) {
      expect((e as WorldFileError).kind).toBe('newer');
    }
  });

  const BROKEN: [string, (m: any) => void][] = [
    ['app 不是这个软件', (m) => (m.app = 'x')],
    ['format 不是整数', (m) => (m.format = 1.5)],
    ['format 是字符串', (m) => (m.format = '1')],
    ['format 是 0', (m) => (m.format = 0)],
    ['kind 不是字符串', (m) => (m.kind = 1)],
    ['id 空的', (m) => (m.id = '')],
    ['id 带控制字符', (m) => (m.id = 'a\u0001')],
    ['id 太长', (m) => (m.id = 'a'.repeat(2000))],
    ['title 太长', (m) => (m.title = 'a'.repeat(300))],
    ['title 带控制字符', (m) => (m.title = 'a\n')],
    ['made 不是对象', (m) => (m.made = 1)],
    ['made.at 不是时间', (m) => (m.made.at = '昨天')],
    ['made.generator 不是整数', (m) => (m.made.generator = '57')],
    ['made.app 带空格', (m) => (m.made.app = '1 5')],
    ['made.commit 不是字符串', (m) => (m.made.commit = 1)],
    ['readers 缺一项', (m) => delete m.readers.query],
    ['readers 不是数', (m) => (m.readers.terrain = 'one')],
    ['readers 是 0', (m) => (m.readers.terrain = 0)],
    ['parts 不是列表', (m) => (m.parts = {})],
    ['parts 太多', (m) => (m.parts = Array.from({ length: 2000 }, (_, i) => ({ ...m.parts[0], name: `x${i}`, file: `parts/x${i}.gz` })))],
    ['缺必须的块', (m) => (m.parts = m.parts.filter((p: any) => p.name !== 'civ'))],
    ['必须的块标成可选', (m) => (m.parts.find((p: any) => p.name === 'map').need = 'extra')],
    ['两块同名', (m) => m.parts.push({ ...m.parts[0], file: 'parts/other.gz' })],
    ['两块同路径', (m) => m.parts.push({ ...m.parts[0], name: 'ext.other', need: 'extra' })],
    ['块名带路径', (m) => (m.parts[0].name = '../map')],
    ['块名大写', (m) => m.parts.push({ ...m.parts.at(-1), name: 'Ext', file: 'parts/ext.bin' })],
    ['路径跳出 parts', (m) => (m.parts[0].file = 'parts/../map.gz')],
    ['路径是绝对路径', (m) => (m.parts[0].file = '/etc/passwd')],
    ['路径带反斜杠', (m) => (m.parts[0].file = 'parts\\map.gz')],
    ['路径不在 parts 底下', (m) => (m.parts[0].file = 'map.gz')],
    ['路径有两层', (m) => (m.parts[0].file = 'parts/a/map.gz')],
    ['路径结尾有点', (m) => (m.parts[0].file = 'parts/map.')],
    ['路径是 Windows 不让用的名字', (m) => (m.parts[0].file = 'parts/con.gz')],
    ['schema 是 0', (m) => (m.parts[0].schema = 0)],
    ['schema 不是整数', (m) => (m.parts[0].schema = 1.5)],
    ['sum 不是 SHA-256', (m) => (m.parts[0].sum = 'abc')],
    ['sum 大写', (m) => (m.parts[0].sum = 'A'.repeat(64))],
    ['bytes 是负数', (m) => (m.parts[0].bytes = -1)],
    ['bytes 超本机的上限', (m) => (m.parts[0].bytes = 1e9 + 1)],
    ['bytes 不是数', (m) => (m.parts[0].bytes = '1')],
    ['need 认不出', (m) => (m.parts[0].need = 'maybe')],
    ['by 不合规矩', (m) => (m.parts[0].by = 'A B')],
    ['plugins 不是列表', (m) => (m.plugins = {})],
    ['plugins 太多', (m) => (m.plugins = Array.from({ length: 65 }, () => ({ id: 'a', version: '1', sum: 'a'.repeat(64), role: 'sim' })))],
    ['插件的指纹不对', (m) => (m.plugins = [{ id: 'a', version: '1', sum: 'x', role: 'sim' }])],
    ['插件的参数太大', (m) => (m.plugins = [{ id: 'a', version: '1', sum: 'a'.repeat(64), role: 'sim', params: { x: 'y'.repeat(70000) } }])],
    ['插件的参数不是对象', (m) => (m.plugins = [{ id: 'a', version: '1', sum: 'a'.repeat(64), role: 'sim', params: 'code()' }])],
    ['revision 不是对象', (m) => (m.revision = 1)],
    ['revision.n 是 0', (m) => (m.revision.n = 0)],
    ['revision.parent 不是指纹', (m) => (m.revision.parent = 'x')],
    ['配方不是对象', (m) => (m.recipe = 1)],
    ['配方不是存档', (m) => (m.recipe.app = 'x')],
    ['配方没有种子', (m) => (delete m.recipe.seed, delete m.recipe.params.seed)],
    ['origin.url 是 http', (m) => (m.recipe.origin = { title: 'x', url: 'http://example.org/s/abcd' })],
    ['origin.url 是脚本', (m) => (m.recipe.origin = { title: 'x', url: 'javascript:alert(1)' })],
    ['origin 不是对象', (m) => (m.recipe.origin = 'x')],
  ];
  it.each(BROKEN)('文件坏了:%s', (_, change) => {
    let err: unknown;
    try {
      parseManifest(manifestOf(change), OPEN);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(WorldFileError);
    expect((err as WorldFileError).kind, (err as Error).message).toBe('broken');
  });

  it('清单里不许用的键:哪一层都拒绝', () => {
    for (const k of ['__proto__', 'constructor', 'prototype']) {
      for (const at of [`{"${k}":{"a":1}}`, `{"a":[{"b":{"${k}":1}}]}`]) {
        const s = JSON.stringify(goodManifest).replace(/^\{/, `{"x":${at},`);
        expect(() => parseManifest(text(s), OPEN), `${k} ${at}`).toThrow('不许用的键');
      }
    }
  });

  it('清单太大、层数太多、不是 JSON、不是 UTF-8', () => {
    expect(() => parseManifest(new Uint8Array(MANIFEST_MAX_BYTES + 1), OPEN)).toThrow('太大');
    expect(() => parseManifest(text('['.repeat(100000)), OPEN)).toThrow('JSON');
    expect(() => parseManifest(text('{'), OPEN)).toThrow('JSON');
    expect(() => parseManifest(new Uint8Array([0x7b, 0xff, 0x7d]), OPEN)).toThrow('JSON');
    expect(() => parseManifest(text('[]'), OPEN)).toThrow(WorldFileError);
    expect(() => parseManifest(text('null'), OPEN)).toThrow(WorldFileError);
  });

  it('ZIP 里的东西要和清单一一对上', async () => {
    await expectKind(async () => openWorldFile(await repack((_, e) => e.push({ name: 'parts/stray.bin', data: text('hello') })), OPEN), 'broken', '多一个没列的条目');
    await expectKind(async () => openWorldFile(await repack((_, e) => e.splice(0, 1)), OPEN), 'broken', '少一块');
    await expectKind(async () => openWorldFile(parseOnlyManifestless(), OPEN), 'broken', '没有清单');
    await expectKind(() => openWorldFile(new Uint8Array(0), OPEN), 'broken', '空文件');
    await expectKind(() => openWorldFile(text('not a zip at all, not even close'), OPEN), 'broken', '不是 ZIP');
  });
  const parseOnlyManifestless = () => {
    // 一个合格的空 ZIP:只有目录结尾
    const end = new Uint8Array(22);
    new DataView(end.buffer).setUint32(0, 0x06054b50, true);
    return end;
  };

  it('块的字节不对:校验、解压都算坏', async () => {
    const swap = await repack((m, e) => {
      const civ = e.findIndex((x) => x.name === 'parts/civ.gz');
      const chron = e.findIndex((x) => x.name === 'parts/chronicle.gz');
      [e[civ].data, e[chron].data] = [e[chron].data, e[civ].data];
    });
    await expectKind(async () => readWorldContent(await openWorldFile(swap, OPEN)), 'broken', '两块字节对调');
    const notGz = await repack((_, e) => (e.find((x) => x.name === 'parts/flags.gz')!.data = text('not gzip')));
    await expectKind(async () => readWorldContent(await openWorldFile(notGz, OPEN)), 'broken', '不是 gzip');
    const short = await repack((m) => (m.parts.find((p: any) => p.name === 'map').bytes -= 1));
    await expectKind(async () => readWorldContent(await openWorldFile(short, OPEN)), 'broken', '说好的字节数少一个');
  }, 30_000);

  it('封面、作者内容是认得的块,坏了也算坏;它们是可选的,没有不碍事', async () => {
    const jpeg = await repack((m, e) => {
      e.find((x) => x.name === 'parts/thumb.jpg')!.data = text('not a jpeg');
    });
    await expectKind(async () => readWorldContent(await openWorldFile(jpeg, OPEN)), 'broken', '封面字节换了');
  }, 30_000);

  it('普通的错都折成「坏了」', () => {
    expect(asWorldFileError(new RangeError('Maximum call stack size exceeded')).kind).toBe('broken');
    expect(asWorldFileError('x').kind).toBe('broken');
    // 开不出内存不是文件坏了
    expect(asWorldFileError(new RangeError('Array buffer allocation failed')).kind).toBe('memory');
    expect(asWorldFileError(new RangeError('Out of memory')).kind).toBe('memory');
    const newer = new WorldFileError('newer', 'x');
    expect(asWorldFileError(newer)).toBe(newer);
  });
});

describe('世界文件:认不出的块原样带着,只当字节', () => {
  const unknownPart = { name: 'ext.magic', file: 'parts/ext.magic.zst', schema: 3, sum: 'a'.repeat(64), bytes: 12345678901, zip: 'zstd', need: 'extra', by: 'magic-sim' };
  const garbage = text('这不是压缩过的字节,校验也对不上;读世界的时候不许碰它');

  it('读世界时不解开、不校验;结构比软件新的可选块也一样', async () => {
    const f = await repack((m, e) => {
      m.parts.push(unknownPart);
      e.push({ name: unknownPart.file, data: garbage });
      m.parts.find((p: any) => p.name === 'author').schema = 99;
      m.parts.find((p: any) => p.name === 'thumb').schema = 99;
    });
    const opened = await openWorldFile(f, OPEN);
    expect(opened.kept.map((p) => p.name)).toEqual(['author', 'thumb', 'ext.magic']);
    const c = await readWorldContent(opened);
    expect(c.author).toBeNull();
    expect(c.thumb).toBeNull();
    expect(c.civ.polities.length).toBe(sample.civ.polities.length);
  }, 30_000);

  it('另存:没换的块字节不动,清单里认不出的字段也带着,修订号加一、记上一份的指纹', async () => {
    const f = await repack((m, e) => {
      m.parts.push(unknownPart);
      e.push({ name: unknownPart.file, data: garbage });
      m.parts.find((p: any) => p.name === 'author').schema = 99;
      m.futureField = { keep: ['me'] };
      m.parts[0].futureToo = 1;
    });
    const opened = await openWorldFile(f, OPEN);
    const next = await bytesOf(await rewriteWorldFile(opened, { title: '新名字', values: { thumb: tinyJpeg(96, 48) } }));
    const again = await openWorldFile(next, OPEN);
    const m = again.manifest as any;
    expect(m.title).toBe('新名字');
    expect(m.revision).toEqual({ n: 2, parent: await sha256(opened.manifestBytes) });
    expect(m.futureField).toEqual({ keep: ['me'] });
    expect(m.parts[0].futureToo).toBe(1);
    expect(again.bytes.get('ext.magic')).toEqual(garbage);
    expect(again.bytes.get('author')).toEqual(opened.bytes.get('author'));
    expect(again.bytes.get('civ')).toEqual(opened.bytes.get('civ'));
    expect(m.parts.find((p: any) => p.name === 'ext.magic')).toEqual(unknownPart);
    expect(again.bytes.get('thumb')).toEqual(tinyJpeg(96, 48));
    // 再存一次:修订号接着加
    const third = await openWorldFile(await rewriteWorldFile(again), OPEN);
    expect(third.manifest.revision.n).toBe(3);
    expect(third.manifest.revision.parent).toBe(await sha256(again.manifestBytes));
  }, 30_000);

  it('另存:去掉可选的块、换内容;换过的块照现在的结构写', async () => {
    const opened = await openWorldFile(good, OPEN);
    const next = await openWorldFile(await rewriteWorldFile(opened, { values: { author: null, thumb: null, chronicle: { entries: [] } } }), OPEN);
    expect(next.manifest.parts.map((p) => p.name)).toEqual(['map', 'eras', 'civ', 'chronicle', 'flags']);
    expect((await readWorldContent(next)).chronicle).toEqual({ entries: [] });
  }, 30_000);

  it('打包时带的附加数据:need 是 extra,记着谁放的,读世界用不着', async () => {
    const f = await packWorldFile({ ...sample, plugins: [{ id: 'magic-sim', version: '1.2.0', sum: 'b'.repeat(64), role: 'sim', params: { mana: 3 } }], extras: [{ name: 'ext.magic', schema: 3, by: 'magic-sim', value: { mana: new Float32Array(4) } }] });
    const opened = await openWorldFile(f, OPEN);
    expect(opened.manifest.plugins[0].id).toBe('magic-sim');
    expect(opened.manifest.parts.at(-1)).toMatchObject({ name: 'ext.magic', file: 'parts/ext.magic.gz', schema: 3, need: 'extra', by: 'magic-sim' });
    expect(opened.kept.map((p) => p.name)).toEqual(['ext.magic']);
    await readWorldContent(opened);
  }, 30_000);
});

describe('世界文件:迁移', () => {
  /** 假的第 2 版历史:endYear 改名叫 lastYear。第 1 版的文件读进来要转成这样;第 2 版的校验器这里不跑,只看转出来的结构 */
  const toV2 = (v: any) => {
    const { endYear, ...rest } = v;
    return { ...rest, lastYear: endYear };
  };
  const manifest = () => goodManifest;

  it('现在只有编年史是第 2 版,别的块都是第 1 版;迁移表里只有编年史那一步', () => {
    for (const k of ['map', 'eras', 'civ', 'flags', 'author', 'thumb', 'ext.magic', 'constructor', '__proto__']) expect(currentSchema(k), k).toBe(1);
    expect(currentSchema('chronicle')).toBe(2);
    for (const [k, steps] of Object.entries(MIGRATIONS)) expect(steps.length, k).toBe(k === 'chronicle' ? 1 : 0);
  });

  it('逐级转到现在的版本:只走缺的那几步', () => {
    const calls: number[] = [];
    const table: MigrationTable = {
      civ: [
        (v: any) => (calls.push(1), { ...v, a: 2 }),
        (v: any) => (calls.push(2), { ...v, b: 3 }),
      ],
    };
    expect(currentSchema('civ', table)).toBe(3);
    expect(migratePart('civ', 1, { x: 1 }, manifest(), table)).toEqual({ x: 1, a: 2, b: 3 });
    expect(calls).toEqual([1, 2]);
    calls.length = 0;
    expect(migratePart('civ', 2, { x: 1 }, manifest(), table)).toEqual({ x: 1, b: 3 });
    expect(calls).toEqual([2]);
    calls.length = 0;
    expect(migratePart('civ', 3, { x: 1 }, manifest(), table)).toEqual({ x: 1 });
    expect(calls).toEqual([]);
  });

  it('迁移拿得到清单', () => {
    const seen: string[] = [];
    migratePart('civ', 1, {}, manifest(), { civ: [(v, m) => (seen.push(m.made.app), v)] });
    expect(seen).toEqual(['1.5.0']);
  });

  it('转不了:某一步抛错、没有返回值,都报只读', () => {
    expect(() => migratePart('civ', 1, {}, manifest(), { civ: [() => { throw new Error('不认识'); }] })).toThrow('不认识');
    try {
      migratePart('civ', 1, {}, manifest(), { civ: [() => undefined] });
      expect.unreachable();
    } catch (e) {
      expect((e as WorldFileError).kind).toBe('readonly');
    }
    try {
      migratePart('civ', 1, {}, manifest(), { civ: [() => { throw new Error('x'); }] });
      expect.unreachable();
    } catch (e) {
      expect((e as WorldFileError).kind).toBe('readonly');
    }
  });

  it('比现在的版本新:报要更新软件', () => {
    try {
      migratePart('civ', 3, {}, manifest(), { civ: [(v) => v] });
      expect.unreachable();
    } catch (e) {
      expect((e as WorldFileError).kind).toBe('newer');
    }
  });

  /** 校验器看的是现在的结构,这张假表转完还要过 validateCiv,所以转回来才算走通 */
  const roundTrip = (v: any) => {
    const { lastYear, ...rest } = toV2(v);
    return { ...rest, endYear: lastYear, migrated: true };
  };

  it('走一遍完整的读法:第 1 版的文件,按有第 2 版的软件读,读出来是转过的', async () => {
    const table: MigrationTable = { ...MIGRATIONS, civ: [roundTrip] };
    const opts = { ...OPEN, migrations: table };
    const c = await readWorldContent(await openWorldFile(good, opts));
    expect((c.civ as any).migrated).toBe(true);
    expect(c.civ.endYear).toBe(sample.civ.endYear);
  }, 30_000);

  it('写第 2 版的文件要新版软件:旧软件(只有第 1 版)读它报要更新', async () => {
    const f = await repack((m) => (m.parts.find((p: any) => p.name === 'civ').schema = 2));
    await expectKind(() => openWorldFile(f, OPEN), 'newer');
    expect((await openWorldFile(f, { ...OPEN, migrations: { ...MIGRATIONS, civ: [roundTrip] } })).manifest.parts.find((p) => p.name === 'civ')!.schema).toBe(2);
  });

  it('转不了:报只读,原件不动,还能照样另存', async () => {
    const opts = { ...OPEN, migrations: { ...MIGRATIONS, civ: [() => { throw new Error('转不了'); }] } as MigrationTable };
    const opened = await openWorldFile(good, opts);
    const before = opened.bytes.get('civ')!.slice();
    await expectKind(() => readWorldContent(opened), 'readonly');
    expect(opened.bytes.get('civ')).toEqual(before);
    const next = await openWorldFile(await rewriteWorldFile(opened), opts);
    expect(next.bytes.get('civ')).toEqual(before);
    expect(next.manifest.parts.find((p) => p.name === 'civ')!.schema).toBe(1);
  }, 30_000);

  it('另存时换掉的块照现在的版本写,没换的还是原来的版本', async () => {
    const opts = { ...OPEN, migrations: { civ: [roundTrip], chronicle: [...MIGRATIONS.chronicle, (v: unknown) => v] } as MigrationTable };
    const opened = await openWorldFile(good, opts);
    const next = await openWorldFile(await rewriteWorldFile(opened, { values: { chronicle: { entries: [] } } }), opts);
    expect(next.manifest.parts.find((p) => p.name === 'chronicle')!.schema).toBe(3);
    expect(next.manifest.parts.find((p) => p.name === 'civ')!.schema).toBe(1);
    expect(next.bytes.get('civ')).toEqual(opened.bytes.get('civ'));
    expect((await readWorldContent(next)).chronicle).toEqual({ entries: [] });
  }, 30_000);

  it('封面也走迁移:转得了读转过的,转不了记在 skipped 里', async () => {
    const yes = await readWorldContent(await openWorldFile(good, { ...OPEN, migrations: { ...MIGRATIONS, thumb: [() => tinyJpeg(100, 50)] } }));
    expect(yes.thumb).toEqual(tinyJpeg(100, 50));
    const opened = await openWorldFile(good, { ...OPEN, migrations: { ...MIGRATIONS, thumb: [() => { throw new Error('转不了'); }] } });
    const no = await readWorldContent(opened);
    expect(no.thumb).toBeNull();
    expect(no.skipped).toEqual(['thumb']);
    expect(opened.bytes.get('thumb')).toEqual(sample.thumb);
  }, 30_000);

  it('可选的块转不了:世界照样看,这一块记在 skipped 里,字节留着', async () => {
    const opts = { ...OPEN, migrations: { ...MIGRATIONS, author: [() => { throw new Error('转不了'); }] } as MigrationTable };
    const opened = await openWorldFile(good, opts);
    const c = await readWorldContent(opened);
    expect(c.author).toBeNull();
    expect(c.skipped).toEqual(['author']);
    const next = await openWorldFile(await rewriteWorldFile(opened), opts);
    expect(next.bytes.get('author')).toEqual(opened.bytes.get('author'));
  }, 30_000);
});

describe('世界文件:单独的后台线程', () => {
  /** 假线程:收到一件事,过一会儿(或者永远不)回话 */
  function fakeWorker(reply: (req: WorldCheckRequest, w: WorldCheckWorker) => void) {
    const state = { terminated: 0 };
    const w: WorldCheckWorker = {
      onmessage: null,
      onerror: null,
      postMessage: (m) => reply(m, w),
      terminate: () => void state.terminated++,
    };
    return { w, state };
  }

  it('核对本身不抛错,结论里分得清', async () => {
    const ok = await checkWorldFile(new Blob([good]), OPEN);
    expect(ok.ok).toBe(true);
    expect((ok as Extract<WorldCheckResult, { ok: true }>).manifest.id).toBe('wsample');
    expect(await checkWorldFile(text('xx'), OPEN)).toMatchObject({ ok: false, kind: 'broken' });
    const newer = await repack((m) => (m.format = 2));
    expect(await checkWorldFile(newer, OPEN)).toMatchObject({ ok: false, kind: 'newer' });
  }, 30_000);

  it('线程答了:交回结论、关掉线程', async () => {
    const { w, state } = fakeWorker((_, me) => setTimeout(() => me.onmessage?.({ data: { ok: false, kind: 'newer', message: 'x' } })));
    const r = await checkWorldFileInWorker(new Blob([]), { readers: READERS, makeWorker: () => w });
    expect(r).toEqual({ ok: false, kind: 'newer', message: 'x' });
    expect(state.terminated).toBe(1);
  });

  it('超时:杀掉线程,结论是超时,不说文件坏了', async () => {
    const { w, state } = fakeWorker(() => undefined);
    const r = await checkWorldFileInWorker(new Blob([]), { readers: READERS, timeoutMs: 20, makeWorker: () => w });
    expect(r).toMatchObject({ ok: false, kind: 'timeout' });
    expect(state.terminated).toBe(1);
  });

  it('线程崩了、开不出来:结论是崩了', async () => {
    const { w, state } = fakeWorker((_, me) => setTimeout(() => me.onerror?.({ message: 'out of memory' })));
    expect(await checkWorldFileInWorker(new Blob([]), { readers: READERS, makeWorker: () => w })).toEqual({ ok: false, kind: 'crash', message: 'out of memory' });
    expect(state.terminated).toBe(1);
    const r = await checkWorldFileInWorker(new Blob([]), { readers: READERS, makeWorker: () => { throw new Error('不让开线程'); } });
    expect(r).toEqual({ ok: false, kind: 'crash', message: '不让开线程' });
  });
});

describe('世界文件:乱改文件反复试(固定种子)', () => {
  /** 出的错必须都是 WorldFileError;读得过去也行(改的地方可能不要紧),不许卡住 */
  async function survives(bytes: Uint8Array): Promise<'ok' | WorldFileErrorKind> {
    try {
      const opened = await openWorldFile(bytes, OPEN);
      await readWorldContent(opened);
      return 'ok';
    } catch (e) {
      if (!(e instanceof WorldFileError)) throw e;
      return e.kind;
    }
  }

  it('改字节(外壳的校验会拦下大部分)、截断、接尾巴', async () => {
    const rng = mulberry32(0x5eed01);
    const seen: Record<string, number> = {};
    for (let i = 0; i < 120; i++) {
      const b = good.slice();
      for (let k = 0, n = 1 + Math.floor(rng() * 8); k < n; k++) b[Math.floor(rng() * b.length)] = Math.floor(rng() * 256);
      const r = await survives(b);
      seen[r] = (seen[r] ?? 0) + 1;
    }
    for (let i = 0; i < 60; i++) {
      const r = await survives(good.subarray(0, Math.floor(rng() * good.length)));
      expect(r).toBe('broken');
    }
    // 只改目录和清单附近:外壳本身的规矩
    for (let i = 0; i < 60; i++) {
      const b = good.slice();
      b[b.length - 1 - Math.floor(rng() * 2048)] = Math.floor(rng() * 256);
      await survives(b);
    }
    expect(seen.broken).toBeGreaterThan(50);
  }, 30_000);

  it('清单乱改(外壳的校验是对的):只读清单,不卡死,错都接得住', () => {
    const rng = mulberry32(0x5eed02);
    const src = text(JSON.stringify(goodManifest));
    const kinds: Record<string, number> = {};
    const POOL = '{}[]",:0123456789-eEnulltruefalse"\\ \n__proto__'.split('');
    for (let i = 0; i < 600; i++) {
      const b = src.slice();
      for (let k = 0, n = 1 + Math.floor(rng() * 4); k < n; k++) b[Math.floor(rng() * b.length)] = POOL[Math.floor(rng() * POOL.length)].charCodeAt(0);
      try {
        parseManifest(b, OPEN);
        kinds.ok = (kinds.ok ?? 0) + 1;
      } catch (e) {
        expect(e).toBeInstanceOf(WorldFileError);
        kinds[(e as WorldFileError).kind] = (kinds[(e as WorldFileError).kind] ?? 0) + 1;
      }
    }
    expect(kinds.broken).toBeGreaterThan(100);
  });
});
