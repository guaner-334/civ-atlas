/**
 * 存成文件、打开文件的界面(worldFileFlow.ts)用到才下载,首页不带。
 * 下载不下来(断网、网站刚更新过):顶上说一句,带「重新加载」。
 */
import { showToast } from './toastStore';

type Flow = typeof import('./worldFileFlow');

/** first:下载不下来时提示条的第一行 */
export function withFileFlow(first: string, f: (m: Flow) => unknown): void {
  import('./worldFileFlow').then(f, () =>
    showToast({
      id: 'world-file',
      kind: 'error',
      text: first,
      more: ['网络断了，或者网站刚更新过，重新加载试试'],
      action: { label: '重新加载', act: 'world-file-reload', onClick: () => location.reload() },
    }),
  );
}
