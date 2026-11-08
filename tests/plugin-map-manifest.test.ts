/**
 * 地图插件的清单(map 段):好样本读得进来、打回去字节一样;写错的各自报在该报的地方;
 * 三样能力进了能力表,权限框一行加图层那一行,底下那句换成地图插件的
 */
import { describe, expect, it } from 'vitest';
import { PERMISSIONS, PERMISSION_FOOTER_MAP, PERMISSION_FOOTER_MAP_LAYERS, PLUGIN_CAPS, capRole, permissionFooter, permissionLines } from '../src/plugin/pluginCaps';
import { openPluginFile, packPluginFile } from '../src/plugin/pluginFile';
import { MAP_STAGE_CAPS, checkMapManifest, mapCapsUnused, type MapManifest } from '../src/plugin/pluginMap';
import { goodMapInput, goodMapPlugin } from './lib/pluginFileSample';

/* eslint-disable @typescript-eslint/no-explicit-any */

const goodMap = (): MapManifest => structuredClone(goodMapInput().manifest.map!);
const requires = () => [...goodMapInput().manifest.requires];

describe('地图插件的清单', () => {
  it('好样本打开后 map 段原样在清单里;再打一遍字节一样', async () => {
    const p = await openPluginFile(await goodMapPlugin());
    expect(p.manifest).toMatchObject({ role: 'map', runtime: 'quickjs', map: goodMapInput().manifest.map });
    expect(await packPluginFile(goodMapInput())).toEqual(await goodMapPlugin());
  });

  it('三步都要、图层用渐变画,一样读得进来', async () => {
    const input = goodMapInput();
    const { why: _w, ...m } = input.manifest;
    const map = { stages: ['height', 'climate', 'layers'], layers: [{ id: 'dem', title: '高度', ramp: { colors: ['#000000', '#ffffff'], min: 0, max: 9000 }, opacity: 0.8 }] };
    const p = await openPluginFile(await packPluginFile({ ...input, manifest: { ...m, requires: ['gen.height@1', 'gen.climate@1', 'gen.layers@1'], map } }));
    expect(p.manifest.map).toEqual(map);
  });

  it('只改高度:不要 layers 也不要滑条', async () => {
    const input = goodMapInput();
    const { why: _w, ...m } = input.manifest;
    const p = await openPluginFile(await packPluginFile({ ...input, manifest: { ...m, requires: ['gen.height@1'], map: { stages: ['height'] } } }));
    expect(p.manifest.map).toEqual({ stages: ['height'] });
  });

  const bad: [string, (s: any) => void, RegExp][] = [
    ['stages 不是列表', (s) => (s.stages = 'climate'), /stages 不是列表/],
    ['stages 空着', (s) => (s.stages = []), /不能空着/],
    ['stages 同一步写了两遍', (s) => s.stages.push('layers'), /写了两遍/],
    ['图层超过 4 张', (s) => s.layers.push(...Array.from({ length: 4 }, (_, i) => ({ ...s.layers[0], id: `l${i}` }))), /最多 4 项/],
    ['图层编号大写', (s) => (s.layers[0].id = 'K'), /id/],
    ['图层没给画法', (s) => delete s.layers[0].classes, /ramp 和 classes/],
    ['图层颜色不是 #rrggbb', (s) => (s.layers[0].classes[0].color = 'blue'), /#rrggbb/],
    ['滑条名字不能当变量名', (s) => (s.params['a-b'] = { label: 'x', min: 0, max: 1, default: 0 }), /只能用字母/],
    ['滑条的下限不小于上限', (s) => (s.params.monsoon.min = 2), /min 要小于 max/],
    ['滑条的步长超过范围', (s) => (s.params.monsoon.step = 5), /step/],
  ];
  it.each(bad)('写错了抛错:%s', (_, change, says) => {
    const s = goodMap();
    change(s);
    expect(() => checkMapManifest({ map: s, requires: requires() })).toThrow(says);
  });

  it('stages 里的一步 requires 没要:报要补哪个能力', () => {
    expect(() => checkMapManifest({ map: goodMap(), requires: ['gen.layers@1'] })).toThrow('要在 requires 里写上 gen.climate@1');
  });

  it('不认得的一步:报这一版网站还没有的那一步', () => {
    const s = goodMap();
    expect(checkMapManifest({ map: s, requires: requires() })).toBeNull();
    s.stages.push('rivers');
    expect(checkMapManifest({ map: s, requires: requires() })).toEqual({ what: '生成的一步', name: 'rivers' });
  });

  it('多要的能力标出来', () => {
    expect(mapCapsUnused({ map: goodMap(), requires: requires() })).toEqual([]);
    expect(mapCapsUnused({ map: { stages: ['climate'] }, requires: requires() })).toEqual(['gen.layers@1']);
    expect(mapCapsUnused({ requires: ['gen.height@1'] })).toEqual(['gen.height@1']);
  });
});

describe('能力表和权限框', () => {
  it('三步各有一样能力,都归地图插件;登记的一步和能力表对得上', () => {
    for (const cap of Object.values(MAP_STAGE_CAPS)) expect(PLUGIN_CAPS.has(`${cap}@1`), cap).toBe(true);
    expect([...PLUGIN_CAPS.keys()].filter((c) => capRole(c) === 'map').sort()).toEqual(Object.values(MAP_STAGE_CAPS).map((c) => `${c}@1`).sort());
  });

  it('改高度、改气候是一行显眼的「会改地图」;出图层是现成的图层那一行;作者的理由跟着', () => {
    const lines = permissionLines(goodMapInput().manifest);
    expect(lines.map((l) => [l.key, l.loud])).toEqual([
      ['mapSteer', true],
      ['layer', false],
    ]);
    expect(lines[0].text).toBe('会改地图（海拔、气候；只影响用它新长的地图，已经长好的世界不变）');
    expect(lines[1].why).toEqual(['画出柯本气候分类']);
    expect(lines[0].why).toEqual(['季风强的地方夏天多下雨']);
    expect(permissionLines({ requires: ['gen.height@1', 'gen.climate@1'] }).map((l) => l.key)).toEqual(['mapSteer']);
    expect(PERMISSIONS.mapSteer.loud).toBe(true);
  });

  it('底下那句:会改地图的不说「改不了」什么;只出图层的说改不了地形和历史', () => {
    expect(permissionFooter(permissionLines(goodMapInput().manifest))).toBe(PERMISSION_FOOTER_MAP);
    expect(permissionFooter(permissionLines(goodMapInput().manifest), 'map')).toBe(PERMISSION_FOOTER_MAP);
    expect(PERMISSION_FOOTER_MAP).not.toContain('改不了');
    expect(permissionFooter(permissionLines({ requires: ['gen.layers@1'] }), 'map')).toBe(PERMISSION_FOOTER_MAP_LAYERS);
    expect(permissionFooter([], 'map')).toBe(PERMISSION_FOOTER_MAP_LAYERS);
    expect(PERMISSION_FOOTER_MAP_LAYERS).toContain('改不了地形和历史');
  });
});
