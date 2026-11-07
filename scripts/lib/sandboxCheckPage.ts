/**
 * 插件隔离自检页(sandbox-check.html,代码在 src/plugin/selfCheck/):只进测试网站的构建,正式网站没有这一页。
 * 单独打包一次再并进网站的构建结果:和首页不共用任何文件,首页要下的东西一个字节都不变。
 */
import { resolve } from 'node:path';
import { build, type Plugin, type PluginOption, type Rollup } from 'vite';

export const CHECK_PAGE = 'sandbox-check.html';

export interface CheckPageFile {
  fileName: string;
  source: string | Uint8Array;
}

export interface CheckPageOptions {
  banner?: string;
  define?: Record<string, string>;
  plugins?: PluginOption[];
}

export async function buildCheckPage(root: string, opts: CheckPageOptions = {}): Promise<CheckPageFile[]> {
  const out = await build({
    configFile: false,
    root,
    base: './',
    logLevel: 'warn',
    publicDir: false,
    define: opts.define,
    plugins: opts.plugins,
    build: {
      write: false,
      modulePreload: false,
      rollupOptions: { input: resolve(root, CHECK_PAGE), output: { banner: opts.banner } },
    },
  });
  const bundle = (Array.isArray(out) ? out[0] : out) as Rollup.RollupOutput;
  return bundle.output.map((o) => ({ fileName: o.fileName, source: o.type === 'chunk' ? o.code : o.source }));
}

/** on 为 false 时什么都不做 */
export function checkPagePlugin(on: boolean, opts: CheckPageOptions = {}): Plugin {
  let root = '';
  return {
    name: 'sandbox-check-page',
    apply: 'build',
    configResolved(c) {
      root = c.root;
    },
    async generateBundle() {
      if (!on) return;
      for (const f of await buildCheckPage(root, opts)) this.emitFile({ type: 'asset', fileName: f.fileName, source: f.source });
    },
  };
}
