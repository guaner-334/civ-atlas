/** 插件界面的开关:构建变量 VITE_PLUGINS 只认 on */
import { afterEach, describe, expect, it, vi } from 'vitest';

const load = async (v: string) => {
  vi.resetModules();
  vi.stubEnv('VITE_PLUGINS', v);
  return import('../src/ui/plugins/flag');
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('插件开关', () => {
  it('VITE_PLUGINS=on 时打开', async () => {
    const f = await load('on');
    expect(f.PLUGINS_UI).toBe(true);
    expect(f.pluginsUiOn()).toBe(true);
  });

  it.each(['off', '', 'ON', '1', 'true'])('VITE_PLUGINS=%j 时关着', async (v) => {
    const f = await load(v);
    expect(f.PLUGINS_UI).toBe(false);
    expect(f.pluginsUiOn()).toBe(false);
  });
});
