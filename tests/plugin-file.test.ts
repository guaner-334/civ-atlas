/**
 * 插件文件:打包再读回、每种错各一个坏样本报对的那一种错、仓库里的样本(服务器也拿它们测)、权限框上列哪几行。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS, PERMISSION_FOOTER, PERMISSION_FOOTER_SIM, PERMISSION_FOOTER_WRITE, PLUGIN_CAPS, permissionFooter, permissionLines, type PermissionKey } from '../src/plugin/pluginCaps';
import { PluginFileError, openPluginFile, packPluginFile, type PluginFileErrorKind } from '../src/plugin/pluginFile';
import { openPluginFileFully } from '../src/plugin/pluginSimTables';
import { PLUGIN_SAMPLES, goodInput, goodPlugin, goodSimInput, goodSimPlugin, put, variant } from './lib/pluginFileSample';

/* eslint-disable @typescript-eslint/no-explicit-any */

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'plugin-file');
const text = (s: string) => new TextEncoder().encode(s);
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

async function expectKind(bytes: Uint8Array, kind: PluginFileErrorKind, hint = '', says = ''): Promise<void> {
  let err: unknown;
  try {
    await openPluginFileFully(bytes);
  } catch (e) {
    err = e;
  }
  expect(err, `应该报错:${hint}`).toBeInstanceOf(PluginFileError);
  expect((err as PluginFileError).kind, `${hint} ${(err as Error).message}`).toBe(kind);
  expect((err as Error).message).toContain(says);
}

describe('插件文件:打包再读回', () => {
  it('清单、各文件、代码和指纹', async () => {
    const bytes = await goodPlugin();
    const p = await openPluginFile(bytes);
    const input = goodInput();
    expect(p.manifest).toMatchObject({ app: '文明与地图', kind: 'plugin', format: 1, entry: 'main.js', ...input.manifest });
    expect(p.manifest.files.map((f) => f.path)).toEqual(['main.js', 'README.md', 'LICENSE', 'icon.png']);
    expect(p.code).toBe(input.files['main.js']);
    expect(p.files.get('icon.png')).toEqual(input.files['icon.png']);
    expect(p.sum).toBe(sha(bytes));
    expect(p.bytes).toBe(bytes.length);
  });

  it('同样的内容打出同样的字节', async () => {
    expect(await packPluginFile(goodInput())).toEqual(await goodPlugin());
  });

  it('Blob 也读得了', async () => {
    const p = await openPluginFile(new Blob([await goodPlugin()]));
    expect(p.manifest.id).toBe('route-measure');
  });

  it('可选的字段、图标都不给也行', async () => {
    const input = goodInput();
    const { optional: _o, why: _w, description: _d, author: _a, ...rest } = input.manifest;
    const { 'icon.png': _i, ...files } = input.files;
    const p = await openPluginFile(await packPluginFile({ manifest: rest, files }));
    expect(p.manifest.files.map((f) => f.path)).toEqual(['main.js', 'README.md', 'LICENSE']);
    expect(p.manifest.optional).toBeUndefined();
  });

  it('optional 里这一版网站没有的能力、清单里认不出的字段都不碍事', async () => {
    const p = await openPluginFile(await variant(({ m }) => void ((m.optional = ['ui.chart@1']), (m.homepage = 'https://example.com'))));
    expect(p.manifest.optional).toEqual(['ui.chart@1']);
  });

  it('又坏又要新网站的,报坏了', async () => {
    await expectKind(await variant((p) => void ((p.m.role = 'sim'), p.files.set('main.js', text('x')))), 'broken');
    await expectKind(await variant((p) => (p.m.requires.push('sim.run@1'), put(p, 'icon.png', text('x')))), 'broken');
  });

  it('打包时放了不认得的文件、清单不对,都抛错', async () => {
    const input = goodInput();
    await expect(packPluginFile({ ...input, files: { ...input.files, 'extra.js': 'x' } })).rejects.toMatchObject({ kind: 'broken' });
    await expect(packPluginFile({ ...input, manifest: { ...input.manifest, id: 'Bad Id' } })).rejects.toMatchObject({ kind: 'broken' });
  });
});

describe('插件文件:每种错一个坏样本', () => {
  it('样本的名字不重复', () => {
    expect(new Set(PLUGIN_SAMPLES.map((s) => s.name)).size).toBe(PLUGIN_SAMPLES.length);
  });
  for (const s of PLUGIN_SAMPLES) {
    it(`${s.name}:${s.why}`, async () => {
      await expectKind(await s.build(), s.kind, s.why, s.says);
    });
  }
  it('表的公式:网页主线程读的时候不查(不带数表引擎),推演线程、服务器读的时候查', async () => {
    const s = PLUGIN_SAMPLES.find((x) => x.name === 'sim-table-formula')!;
    const bytes = await s.build();
    expect((await openPluginFile(bytes)).manifest.id).toBe('magic');
    await expectKind(bytes, 'broken', s.why, s.says);
  });
});

describe('仓库里的样本', () => {
  const index: { file: string; kind: string; why: string }[] = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8'));

  it('和样本表对得上(改了样本表要跑 scripts/plugin-file-samples.ts)', () => {
    const want = ['good', 'good-sim', 'good-map', ...PLUGIN_SAMPLES.filter((s) => !s.big).map((s) => s.name)].map((n) => `${n}.civplugin`);
    expect(index.map((e) => e.file)).toEqual(want);
  });

  for (const e of index) {
    it(`${e.file}:${e.why}`, async () => {
      const bytes = new Uint8Array(readFileSync(join(DIR, e.file)));
      if (e.kind === 'ok') expect((await openPluginFile(bytes)).sum).toBe(sha(bytes));
      else await expectKind(bytes, e.kind as PluginFileErrorKind, e.why);
    });
  }
});

describe('要更新网站时说清要的是什么', () => {
  const needOf = async (change: (m: any) => void) => {
    try {
      await openPluginFile(
        await variant((p) => {
          change(p.m);
        }),
      );
    } catch (e) {
      return e as PluginFileError;
    }
    throw new Error('应该报错');
  };

  it('不认识的能力、格式、接口、种类各说各的;读得出名字就带上', async () => {
    const cap = await needOf((m) => m.requires.push('sim.run@1'));
    expect([cap.kind, cap.need, cap.plugin]).toEqual(['newer', '推演 第 1 版', '量路程']);
    expect((await needOf((m) => (m.requires[0] = 'world.read@2'))).need).toBe('world.read 第 2 版');
    expect((await needOf((m) => (m.format = 2))).need).toBe('第 2 版插件文件');
    expect((await needOf((m) => (m.api = 3))).need).toBe('第 3 版插件接口');
    expect((await needOf((m) => (m.role = 'dream'))).need).toBe('dream 这种插件');
  });

  it('格式更新时名字还没查过:名字不合规矩就不带', async () => {
    const e = await needOf((m) => {
      m.format = 2;
      m.name = 'a\u202eb';
    });
    expect(e.kind).toBe('newer');
    expect(e.plugin).toBeUndefined();
  });
});

describe('权限框', () => {
  it('每样能力都有归属,每一行都有能力', () => {
    const used = new Set([...PLUGIN_CAPS.values()].filter((k) => k !== null));
    expect([...used].sort()).toEqual(Object.keys(PERMISSIONS).sort());
  });

  it('看你写的东西、改你写的东西单列一行而且显眼;存自己的数据单列一行,后果写在小字里', () => {
    expect(PLUGIN_CAPS.get('author.write@1')).toBe('authorWrite');
    expect(PLUGIN_CAPS.get('store.world@1')).toBe('storeWorld');
    const loud = (Object.keys(PERMISSIONS) as PermissionKey[]).filter((k) => PERMISSIONS[k].loud);
    expect(loud).toEqual(['authorRead', 'authorWrite', 'simSteer', 'mapSteer']);
    expect(PERMISSIONS.storeWorld.note).toContain('不能公开分享');
    expect(PERMISSIONS.authorWrite.note).toContain('能撤销');
  });

  it('底下那句:要了改你写的东西的插件不说「改不了历史」', () => {
    const read = permissionLines({ requires: ['world.read@1', 'ui.panel@1'] });
    const write = permissionLines({ requires: ['history.read@1', 'author.write@1'] });
    expect(permissionFooter(read)).toBe(PERMISSION_FOOTER);
    expect(permissionFooter(write)).toBe(PERMISSION_FOOTER_WRITE);
    expect(PERMISSION_FOOTER).toContain('改不了历史');
    expect(PERMISSION_FOOTER_WRITE).not.toContain('改不了历史');
    expect(write.find((l) => l.key === 'authorWrite')!.note).toBe(PERMISSIONS.authorWrite.note);
  });

  it('按表的先后列,同一行只列一次,作者写的理由跟着那一行', () => {
    const lines = permissionLines({
      requires: ['layer.marks@1', 'view.read@1', 'input.pick@1', 'world.read@1', 'ui.panel@1'],
      optional: ['layer.cells@1', 'store.world@1'],
      why: { 'input.pick@1': '点起点和终点', 'layer.cells@1': '画路程远近' },
    });
    expect(lines.map((l) => l.key)).toEqual(['map', 'view', 'layer', 'storeWorld']);
    expect(lines.find((l) => l.key === 'view')!.why).toEqual(['点起点和终点']);
    expect(lines.find((l) => l.key === 'layer')!.why).toEqual(['画路程远近']);
  });

  it('网站没有的 optional 能力不列;人人都有的不列', () => {
    expect(permissionLines({ requires: ['ui.panel@1', 'store.local@1'], optional: ['ui.chart@1'] })).toEqual([]);
  });
});
