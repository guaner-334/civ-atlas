/**
 * tests/lib/mapPlugins.ts 的三个测试地图插件(环形山、柯本气候、潮汐)打成地图插件文件:插件代码是去掉类型的源码,
 * 在哪几步出手、登记的图层和画法、滑条写进清单的 map 段。从文件装进 QuickJS 长出来的地图应该和直接跑一样
 */
import { fileURLToPath } from 'node:url';
import { packPluginFile, type PluginPackInput } from '../../src/plugin/pluginFile';
import type { MapManifest } from '../../src/plugin/pluginMap';
import { pluginScript } from '../../scripts/lib/quickjsNode';

const FILE = fileURLToPath(new URL('./mapPlugins.ts', import.meta.url));
const LICENSE = 'MIT License\n\nCopyright (c) 2026\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software.\n';

export type MapTestPlugin = 'craters' | 'koppen' | 'tides';

const KOPPEN = ['Af', 'Am', 'Aw', 'BWh', 'BWk', 'BSh', 'BSk', 'Csa', 'Csb', 'Csc', 'Cwa', 'Cwb', 'Cwc', 'Cfa', 'Cfb', 'Cfc', 'Dsa', 'Dsb', 'Dsc', 'Dsd', 'Dwa', 'Dwb', 'Dwc', 'Dwd', 'Dfa', 'Dfb', 'Dfc', 'Dfd', 'ET', 'EF'];
const hex2 = (v: number) => v.toString(16).padStart(2, '0');

const SPEC: Record<MapTestPlugin, { name: string; make: string; requires: string[]; map: MapManifest }> = {
  craters: {
    name: '环形山',
    make: 'craters()',
    requires: ['gen.height@1'],
    map: { stages: ['height'], params: { count: { label: '坑数', min: 0, max: 200, default: 40, step: 1 } } },
  },
  koppen: {
    name: '柯本气候',
    make: 'koppen()',
    requires: ['gen.climate@1', 'gen.layers@1'],
    map: {
      stages: ['climate', 'layers'],
      layers: [{ id: 'koppen', title: '柯本气候', classes: KOPPEN.map((label, i) => ({ value: i, color: `#${hex2(8 * i)}${hex2(255 - 8 * i)}80`, label })), legend: '柯本 - 盖格分类' }],
    },
  },
  tides: {
    name: '潮汐',
    make: 'tides()',
    requires: ['gen.layers@1'],
    map: { stages: ['layers'], layers: [{ id: 'tide', title: '潮差', ramp: { colors: ['#DBEAFE', '#1e3a8a'], min: 0, max: 12 }, legend: '米', opacity: 0.8 }] },
  },
};

/** 一个插件的打包输入 */
export function mapTestInput(which: MapTestPlugin, version = '1.0.0'): PluginPackInput {
  const s = SPEC[which];
  return {
    manifest: { id: which, name: s.name, version, role: 'map', api: 1, runtime: 'quickjs', requires: s.requires, map: s.map, license: 'MIT' },
    files: { 'main.js': pluginScript(FILE, s.make, 'map'), 'README.md': `# ${which}\n`, LICENSE },
  };
}

const packed = new Map<string, Promise<Uint8Array>>();

/** 打好的插件文件(同样的输入打一次) */
export function mapTestFile(which: MapTestPlugin, version = '1.0.0'): Promise<Uint8Array> {
  const key = `${which}@${version}`;
  let p = packed.get(key);
  if (!p) packed.set(key, (p = packPluginFile(mapTestInput(which, version))));
  return p;
}
