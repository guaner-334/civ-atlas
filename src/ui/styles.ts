/**
 * 页面上所有的样式,按这个先后拼成同一个文件,打开网页时和首页的代码一起下载。
 *
 * 代码拆成了首页先下的一份和后台接着下的主程序(见 Boot.tsx),样式不跟着拆:还是一个文件、先后照旧。
 * 先后要紧 —— 同样具体的写法后面的盖过前面的(宽屏、手机的布局放在最后,盖过各处的默认样式)。
 * 各组件里照旧 import 自己用的样式(这里已经放过的不再重复),先后以这里为准;新加的样式文件也加在这里。
 */
import './theme.css';
import './account.css';
import './ai.css';
import './countryPanel.css';
import './globe.css';
import './timeline.css';
import './flags.css';
import './director.css';
import './stepwise.css';
import './extend.css';
import './book.css';
import './shortcuts.css';
import './diag.css';
import './tips.css';
import './portrait.css';
import './characters.css';
import './policy.css';
import './newIv.css';
import './upheaval.css';
import './marks.css';
import './params.css';
import './assistant.css';
import './contact.css';
import './betaNews.css';
import './overview.css';
import './worlds.css';
import './gallery.css';
import './studio/studio.css';
import './states.css';
import './sidebar.css';
import './outline.css';
import './stepBranches.css';
import './newWorld.css';
import './film.css';
import './long.css';
import './app.css';
import './desktop.css';
import './phone.css';
