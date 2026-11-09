import { describe, expect, it } from 'vitest';
import { installHowText, noShareText, noWallVersionText } from '../src/ui/plugins/pluginWords';

describe('没有服务器时插件的字不提作品墙', () => {
  it('没装插件那一页', () => {
    expect(installHowText(false)).toBe('在插件页里从文件装，装好回到这里选。');
    expect(installHowText(true)).toBe('在插件页里从作品墙或文件装，装好回到这里选。');
  });
  it('本机没装的插件下面那句', () => {
    expect(noWallVersionText(false)).toBe('向分享这个世界的人要插件文件，在「插件」页从文件装');
    expect(noWallVersionText(true)).toBe('作品墙上没有这一版：向分享这个世界的人要插件文件，在「插件」页从文件装');
  });
  it('往世界里存插件数据后不能做的事', () => {
    expect(noShareText(false)).toBe('不能复制链接、不能分享');
    expect(noShareText(true)).toBe('不能复制链接、不能分享、不能投到作品墙');
  });
});
