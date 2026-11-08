/** 浏览器里取 QuickJS 的 wasm(用到插件才下载;一个线程编译一次,失败了下次再试) */
import url from '@jitl/quickjs-wasmfile-release-sync/wasm?url';

let compiled: Promise<WebAssembly.Module> | null = null;

async function compile(): Promise<WebAssembly.Module> {
  try {
    return await WebAssembly.compileStreaming(fetch(url));
  } catch (e) {
    // 网站服务器没把 .wasm 标成 application/wasm 时边下边编译不了,整个下完再编译
    if (!(e instanceof TypeError)) throw e;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`QuickJS 下载失败(${res.status})`);
  return WebAssembly.compile(await res.arrayBuffer());
}

export function quickjsWasm(): Promise<WebAssembly.Module> {
  if (!compiled) {
    compiled = compile();
    compiled.catch(() => (compiled = null));
  }
  return compiled;
}
