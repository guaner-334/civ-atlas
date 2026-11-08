/**
 * 钉住插件图层格式第 1 版(docs/plugins/layer-format.md)。tests/fixtures/plugin-layers/ 里是第 1 版做好的世界文件,
 * 用的人手里存了插件图层的世界就长这样:工具插件的地块图层(存满 16 个)、推演插件按州按年份的图层(各成一块,或在历史那一块里)、带年份的地块图层。
 *
 * **这个测试红了,说明用的人存好的插件图层打不开了,或者画出来变了。** 样本和 v1.json 不能改、不能重新做一份:
 * 改掉它们,测试是绿了,用的人手里的世界还是打不开、颜色还是变了。正确的修法只有一个:改代码,让它照第 1 版继续读、照原样画
 * (格式真要变,就出第 2 版:清单里那一块的 schema 加一,读的时候把第 1 版转成新的)。
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Civ } from '../src/gen/civ/types';
import { READER_VERSIONS } from '../src/gen/readers/versions';
import { packValue, recipeKey, recipeOfSave, sha256 } from '../src/gen/snapshot';
import { opaqueParts } from '../src/gen/worldFile';
import { PLUGIN_LAYERS_MAX, PLUGIN_LAYER_SCHEMA } from '../src/gen/worldFormat';
import { simLayerPaint } from '../src/plugin/simTrial';
import { cellColors, framePaint, regionsToCells } from '../src/render/pluginLayer';
import { openStoredWorld } from '../src/worldOpen';
import { _resetVault, adoptFile, readPluginLayers } from '../src/worldVault';
import { FACTS_FILE, LAYER_DIR, layerFacts, openSample, type OpenedSample, type SampleFacts } from './lib/pluginLayerFacts';

const FACTS = JSON.parse(readFileSync(FACTS_FILE, 'utf8')) as Record<string, SampleFacts>;
const SAMPLES = Object.keys(FACTS);
const FIX_IT = '用的人存好的插件图层就长这样,读不开或者画出来变了,他们的世界也一样。不能改样本和 v1.json:请改代码让它照第 1 版继续读、照原样画';

const files = new Map<string, Uint8Array>();
const opened = new Map<string, OpenedSample>();
const bytes = (v: unknown) => Buffer.from(packValue(v));

beforeAll(async () => {
  for (const name of SAMPLES) {
    const file = new Uint8Array(readFileSync(join(LAYER_DIR, name)));
    files.set(name, file);
    opened.set(name, await openSample(file));
  }
}, 60_000);

describe('插件图层格式第 1 版', () => {
  it('三个样本都在:工具插件的地块图层、推演插件的图层各成一块、推演插件的图层在历史那一块里', () => {
    expect([...SAMPLES].sort(), FIX_IT).toEqual(['v1-cells.civworld', 'v1-sim-blocks.civworld', 'v1-sim-civ.civworld']);
  });

  describe.each(SAMPLES)('%s', (name) => {
    it('这份文件本身没被改过', async () => {
      const file = files.get(name)!;
      expect(await sha256(file), `这份样本被动过了。${FIX_IT}`).toBe(FACTS[name].sha256);
      expect(file.length).toBe(FACTS[name].bytes);
    });

    it('打得开,图层块都是第 1 版、逐项核对过,一块都没跳过、没有只当字节留着的', () => {
      const s = opened.get(name)!;
      const blocks = s.opened.manifest.parts.filter((p) => p.name.startsWith('layer.'));
      expect(blocks.length, FIX_IT).toBeLessThanOrEqual(PLUGIN_LAYERS_MAX);
      for (const p of blocks) expect({ schema: p.schema, need: p.need, by: p.by }, `${p.name} ${FIX_IT}`).toEqual({ schema: PLUGIN_LAYER_SCHEMA, need: 'extra', by: p.name.split('.')[1] });
      expect(opaqueParts(s.opened.manifest.parts), FIX_IT).toEqual([]);
      expect(s.content.skipped, FIX_IT).toEqual([]);
    });

    it('每个图层每一份、每一格的数和颜色都和存下时一样', () => {
      const got = opened.get(name)!.layers.map(layerFacts);
      expect(got.map((l) => l.at), FIX_IT).toEqual(FACTS[name].layers.map((l) => l.at));
      got.forEach((l, i) => expect(l, `${l.at} ${FIX_IT}`).toEqual(FACTS[name].layers[i]));
    });

    it('一份的图层按存着的画(图层面板的画法)和按年份挑出来画一样;按州的图层铺到地块上,每块地是它所在的州的颜色', () => {
      const s = opened.get(name)!;
      for (const l of s.layers) {
        if (!l.value.years) expect(Buffer.from(cellColors(framePaint(l.value, 0)!)).equals(Buffer.from(cellColors(l.value))), l.at).toBe(true);
        if (l.value.unit !== 'region') continue;
        const of = s.content.civ.regions.of;
        const year = s.content.civ.endYear;
        const frame = framePaint(l.value, year)!;
        const byRegion = cellColors(frame);
        const want = new Uint8Array(of.length * 4);
        for (let c = 0; c < of.length; c++) if (of[c] >= 0 && of[c] < frame.values.length) want.set(byRegion.subarray(of[c] * 4, of[c] * 4 + 4), c * 4);
        expect(Buffer.from(cellColors(regionsToCells(frame, of))).equals(Buffer.from(want)), l.at).toBe(true);
      }
      const first = s.layers.find((l) => l.history);
      if (first) expect(Buffer.from(cellColors(simLayerPaint(s.content.civ, s.content.civ.endYear)!)).equals(Buffer.from(cellColors(regionsToCells(framePaint(first.value, s.content.civ.endYear)!, s.content.civ.regions.of))))).toBe(true);
    });

    it('收进本机仓库以后:图层面板读到的工具插件图层、打开世界时接回的推演插件图层,和直接读文件的一样', async () => {
      (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
      _resetVault();
      const s = opened.get(name)!;
      const id = `w${name.replace(/\W/g, '')}`;
      const key = await recipeKey(recipeOfSave(s.content.save));
      await adoptFile({ id, file: new Blob([files.get(name)!]), sum: await sha256(s.opened.manifestBytes), recipeKey: key, generator: s.content.save.generator, readers: { ...READER_VERSIONS } });

      // 一份的工具插件图层一个不能少;面板列出来的每一个都要和文件里的一样
      const shown = await readPluginLayers(id, s.content.map.mesh.n);
      const names = shown.map((r) => r.name);
      for (const l of s.layers.filter((x) => !x.history && !x.value.years)) expect(names, FIX_IT).toContain(l.at);
      for (const r of shown) {
        const l = s.layers.find((x) => x.at === r.name && !x.history);
        expect([r.by, r.layer], `${r.name} ${FIX_IT}`).toEqual([l?.by, l?.id]);
        expect(bytes(r.data).equals(bytes(l!.value)), `${r.name} ${FIX_IT}`).toBe(true);
      }

      const history = s.content.civ.simLayers;
      const ask = { id, recipe: key, generator: s.content.save.generator };
      for (const round of ['第一次打开', '再打开']) {
        const civ = (await openStoredWorld(ask)).civ as Civ;
        expect(bytes(civ.simLayers).equals(bytes(history)), `${round} ${FIX_IT}`).toBe(true);
      }
      _resetVault();
    }, 60_000);
  });

  it('推演插件的图层各成一块、放在历史那一块里,是同一段历史的两种存法:读出来一模一样', () => {
    const blocks = opened.get('v1-sim-blocks.civworld')!.content.civ.simLayers;
    const inCiv = opened.get('v1-sim-civ.civworld')!.content.civ.simLayers;
    expect(blocks?.length).toBe(5);
    expect(bytes(blocks).equals(bytes(inCiv))).toBe(true);
  });
});
