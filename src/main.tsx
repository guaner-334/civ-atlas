import { createRoot } from 'react-dom/client';
import { scrubSecrets } from './ai/settings';
import { setDiagScrubber } from './diag/log';
import { installDiagWatch } from './diag/watch';
import { App } from './ui/App';
import './ui/app.css';
// 宽屏、手机的布局放在最后,盖过各处的默认样式
import './ui/desktop.css';
import './ui/phone.css';

// 问题记录:最先接上,启动时出的错也记得到
setDiagScrubber(scrubSecrets);
installDiagWatch();

createRoot(document.getElementById('root')!).render(<App />);
