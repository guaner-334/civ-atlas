/**
 * tests/lib/simV1Plugins.ts 的两个插件(厌战、宗教生效)打成推演插件文件:插件代码是去掉类型的源码,设定写进清单的 sim 段。
 * 从文件装进 QuickJS 跑出来的历史应该和直接跑一样
 */
import { fileURLToPath } from 'node:url';
import { packPluginFile, type PluginPackInput } from '../../src/plugin/pluginFile';
import type { SimManifest } from '../../src/plugin/pluginSim';
import { pluginScript } from '../../scripts/lib/quickjsNode';
import { faithEffect, weariness } from './simV1Plugins';

const V1 = fileURLToPath(new URL('./simV1Plugins.ts', import.meta.url));
const REQUIRES = ['sim.read@1', 'sim.events@1', 'sim.influence@1', 'sim.commands@1', 'sim.chronicle@1', 'sim.state@1'];
const LICENSE = 'MIT License\n\nCopyright (c) 2026\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software.\n';

/** 一个插件的打包输入;sim 段里另加的几项(滑条之类)用 more 盖上 */
export function simV1Input(which: 'weariness' | 'faith', version = '1.0.0', more: Partial<SimManifest> = {}): PluginPackInput {
  const native = which === 'weariness' ? weariness() : faithEffect();
  const sim: SimManifest = {
    ...(native.every !== undefined ? { every: native.every } : {}),
    ...(native.listen ? { listen: [...native.listen] } : {}),
    ...(native.influences ? { influences: [...native.influences] } : {}),
    commands: which === 'weariness' ? ['treaty'] : ['declare', 'ally'],
    ...more,
  };
  return {
    manifest: { id: native.id, name: which === 'weariness' ? '厌战' : '宗教生效', version, role: 'sim', api: 1, runtime: 'quickjs', requires: REQUIRES, sim, license: 'MIT' },
    files: { 'main.js': pluginScript(V1, which === 'weariness' ? 'weariness()' : 'faithEffect()'), 'README.md': `# ${native.id}\n`, LICENSE },
  };
}

const packed = new Map<string, Promise<Uint8Array>>();

/** 打好的插件文件(同样的输入打一次) */
export function simV1File(which: 'weariness' | 'faith', version = '1.0.0'): Promise<Uint8Array> {
  const key = `${which}@${version}`;
  let p = packed.get(key);
  if (!p) packed.set(key, (p = packPluginFile(simV1Input(which, version))));
  return p;
}
