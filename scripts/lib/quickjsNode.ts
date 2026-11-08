/**
 * Node 里(单测、压力测试)用 QuickJS 跑推演插件:wasm 从磁盘读;照接口写的 TS 插件去掉类型,当插件代码交给 QuickJS
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

let wasm: WebAssembly.Module | null = null;

/** 编译好的 QuickJS(一个进程编译一次) */
export function quickjsWasm(): WebAssembly.Module {
  return (wasm ??= new WebAssembly.Module(readFileSync(createRequire(import.meta.url).resolve('@jitl/quickjs-wasmfile-release-sync/wasm'))));
}

/** TS 写的插件文件 → 插件代码:去掉类型和 export,末尾 civAtlas.sim(make)(如 'weariness()');文件里只能有 import type */
export function pluginScript(file: string, make: string): string {
  const js = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  if (/^import /m.test(js)) throw new Error(`${file} 引了别的代码,QuickJS 里没有`);
  return `${js.replace(/^export \{\};?$/gm, '').replace(/^export /gm, '')}\ncivAtlas.sim(${make});\n`;
}
