/** 修改、删除地图和照图原样的开关:测试网站一直开着,正式网站关着 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const load = async (beta: boolean, dev: boolean) => {
  vi.resetModules();
  vi.doMock('../src/ui/oldSite', () => ({ BETA_SITE: beta }));
  vi.stubEnv('DEV', dev);
  const [m, e] = await Promise.all([import('../src/ui/mapEditFlag'), import('../src/ui/exactImageFlag')]);
  return [m.mapEditOn(), e.exactImageOn()];
};

afterEach(() => {
  vi.doUnmock('../src/ui/oldSite');
  vi.unstubAllEnvs();
});

describe('地图页的两个开关', () => {
  it('测试网站上开着', async () => {
    expect(await load(true, false)).toEqual([true, true]);
  });

  it('正式网站上关着', async () => {
    expect(await load(false, false)).toEqual([false, false]);
  });

  it('本机开发不带网址参数时关着', async () => {
    expect(await load(false, true)).toEqual([false, false]);
  });
});
