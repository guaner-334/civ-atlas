// 所有样式最先放进来,先后见 ui/styles.ts(宽屏、手机的布局在最后,盖过各处的默认样式)
import './ui/styles';
import { createRoot } from 'react-dom/client';
import { scrubSecrets } from './ai/settings';
import { setDiagScrubber } from './diag/log';
import { installDiagWatch } from './diag/watch';
import { Boot } from './ui/Boot';

// 问题记录:最先接上,启动时出的错也记得到
setDiagScrubber(scrubSecrets);
installDiagWatch();

// 先出首页、主程序在后台下载;不是首页的直接下载主程序(Boot.tsx)
createRoot(document.getElementById('root')!).render(<Boot />);
