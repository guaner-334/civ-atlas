# 接口参考(第 1 版)

这一页是工具插件(`role: "tool"`)的接口。推演插件(`role: "sim"`)拿到的 `civAtlas` 只有 `sim` 和 `params`,一回合、回话、读口这些见[推演插件](sim.md)。

插件代码在后台线程里跑,拿到一个全局对象 `civAtlas`。类型定义在 [`src/plugin/types.ts`](../../src/plugin/types.ts),每个调用要哪样能力在 [`src/plugin/caps.ts`](../../src/plugin/caps.ts)。

## 怎么调

```js
const info = await civAtlas.world.info();
const { elevation } = await civAtlas.world.cells({ fields: ['elevation'] });
```

- 每个调用只收**一个参数对象**(没参数的可以不给),返回 Promise
- 没要那样能力就调,回 `no-permission`;每个调用要什么能力写在下面各节的标题上
- 出错时 Promise 拒绝,拿到的 `Error` 上有 `code`(见[出错码](#出错码))和一句说明 `message`。出错不会让插件停下,接着调就行
- 网站递进来的东西都是新复制的一份(大数组直接转交给插件),插件随便改,世界不受影响
- `civAtlas.request('world.cells', { fields: [...] })` 和 `civAtlas.world.cells({ fields: [...] })` 一样,按名字调
- 插件代码顶层同步跑完才算开好(10 秒内);顶层里就可以调接口,开好以后才发出去

**编号和键。** 地块、国家、城这些都有编号(`id`,数组下标),只在这一次打开的世界里有效:改了历史、改了地形可能就变了。国家、城、州、民族、信仰、人物、地名另有**稳定键**(`key`,比如 `polity:c4567#0`),按地块定位,改历史以后尽量还指着同一个;改名、加标记、下命令都用键。

## 基本

### `civAtlas.host.info()` — 不要能力

```ts
{ api: 1, app: '文明与地图', caps: ['world.read@1', ...], cells: 36000 }
```

`caps` 是这次真给了插件的能力(`requires` 加上用的人同意了的 `optional`);`cells` 是地块数,还没打开世界时是 0。有可选能力时用它判断给没给:

```js
const { caps } = await civAtlas.host.info();
if (caps.includes('history.read@1')) { /* 用历史 */ }
```

### `civAtlas.log(...parts)` — 不要能力

写一条日志(开发者模式里看)。各部分不是字的转成 JSON,用空格连起来;一条最多 2000 个字,长了只记前 2000 个字,末尾标上截掉了多少。不返回 Promise,也不会出错。

插件代码里没接住的 Promise 出错(比如 `async` 函数里抛出、没人 `catch` 的错)也记进日志,记成「出错」;插件不会因此停下。开发者模式见[插件开发](README.md#开发者模式)。

### `civAtlas.on(event, fn)`

听网站发来的事件,返回一个取消的函数。没要那样能力的事件收不到。

| 事件 | 要的能力 | 收到什么 |
|---|---|---|
| `view.year` | `view.read@1` | `{ year }`:用的人换了看的年份 |
| `view.select` | `view.read@1` | 选中的东西(同 `view.get()` 的 `selected`),取消选中是 `null` |
| `panel.action` | `ui.panel@1` | `{ id, value? }`:用的人动了插件面板上的控件,见[插件面板](#插件面板uipanel1) |

`view.year`、`view.select` 合并着发:最快每 250 毫秒一次,只发最新的。事件回调里抛出没接住的错,插件会被停掉,回调里要自己 `try/catch`。

`civAtlas.post`、`onMessage`、`onCall` 是网站和插件之间的底层传话,网站这边还没有用到它们的地方,写插件用不着。

## 地图(`world.read@1`)

### `world.info()`

```ts
{ title, seed, cells, width, height, kmPerUnit }
```

| 字段 | 意思 |
|---|---|
| `title` | 世界名 |
| `seed` | 种子 |
| `cells` | 地块数 |
| `width`、`height` | 主图的宽高(世界坐标,现在是 2048 × 1024)。`x` 从 0 到 `width` 对应经度 −180° 到 180°(东西两头连着),`y` 从 0 到 `height` 对应纬度 90° 到 −90° |
| `kmPerUnit` | 一个世界单位约多少公里(赤道处;离赤道越远,东西方向的一个单位越短) |

### `world.cells({ fields })`

每个地块一个数,一次取几种(`fields` 1–16 项)。返回 `{ 名字: 数组 }`,数组长度都是地块数。

| 名字 | 类型 | 意思 |
|---|---|---|
| `x`、`y` | Float32Array | 地块中心的世界坐标 |
| `lon`、`lat` | Float32Array | 经度、纬度(度) |
| `area` | Float32Array | 面积(平方公里) |
| `elevation` | Float32Array | 海拔(米,海里是负的) |
| `water` | Uint8Array | 0 陆地 / 1 海洋 / 2 湖泊 |
| `temperature` | Float32Array | 年均温(°C) |
| `precipitation` | Float32Array | 年降水(毫米) |
| `biome` | Uint8Array | 生物群落编号,名字用 `world.legend({ kind: 'biome' })` 查 |
| `flux` | Float32Array | 径流量(从上游累计下来的) |
| `seaIce` | Float32Array | 海冰,0–1 |

### `world.neighbors()`

```ts
{ start: Int32Array, list: Int32Array }
```

相邻表:地块 `i` 的邻居是 `list[start[i]]` 到 `list[start[i + 1] - 1]`。

```js
for (let k = start[i]; k < start[i + 1]; k++) { const j = list[k]; /* j 和 i 相邻 */ }
```

### `world.rivers()`

河的列表,每条 `{ cells: Int32Array }`:从源头到入海、入湖处经过的地块。

### `world.legend({ kind })`

`kind` 是 `'biome'` 或 `'water'`,返回 `[{ value, name }]`:编号对应的名字。

## 历史(`history.read@1`)

世界还没推出历史时回 `unavailable`。年份从 0 到 `history.span()` 的 `to`,超出回 `bad-args`。

### `history.span()`

`{ from: 0, to }`:历史从哪年到哪年。

### `history.at({ year, fields })`

某一年每个地块的归属,`fields` 从下面挑:

| 名字 | 类型 | 意思 |
|---|---|---|
| `polity` | Int16Array | 属于哪国(国家编号) |
| `culture` | Int16Array | 哪个民族 |
| `faith` | Int16Array | 哪种信仰 |
| `region` | Int32Array | 在哪个州 |

−1 = 没有(水上、没人住)。

### `history.polities({ year? })` 等列表

给了 `year` 只列那一年在的,名字、国都、人口这些也按那一年;不给列全部。字段详见 `types.ts` 里同名的类型。

| 调用 | 每项 | 主要字段 |
|---|---|---|
| `history.polities({ year? })` | `PolityInfo` | `id`、`key`、`name`(那一年的全称;不给年份 = 最后一年的)、`root`(国名词根)、`color`、`founded`、`ended?`、`capital`(国都,城的编号)、`culture`、`parent?` |
| `history.settlements({ year? })` | `SettlementInfo` | `id`、`key`、`name`、`cell`、`region`、`founded`、`ended?`、`port`;给了年份才有 `population`(千人)和 `rank`(0 村 / 1 镇 / 2 城 / 3 大城) |
| `history.routes({ year? })` | `RouteInfo` | `kind`(`road` / `trail` / `sea`)、`cells`(Int32Array)、`built`、`abandoned?` |
| `history.regions({ year? })` | `RegionInfo` | `id`、`key`、`name`(没人住过的州是空的)、`seat`(治所地块)、`area`(平方公里);给了年份才有 `population`(千人) |
| `history.places()` | `PlaceInfo` | 地名:`id`、`key`、`kind`(`sea` / `mountains` / `river` / `lake` / `island` / `desert` / `pass`)、`name`、`cell?`、`rank` |
| `history.cultures()` | `CultureInfo` | `id`、`key`、`name`、`kind`、`hearth`(发源的州)、`born`、`ended?`、`color`、`parent?` |
| `history.faiths()` | `FaithInfo` | `id`、`key`、`name`、`kind`、`form?`、`culture?`、`parent?`、`founded?`、`holy?`(圣城)、`color` |

颜色一律写成 `#rrggbb`。名字都是套上了用的人改过的名字以后的。

### `history.people({ offset?, limit?, polity?, role? })`

人物,分页取:`limit` 最多 2000(不给就是 2000)。`polity` 只要某国的,`role` 只要某一种(`ruler` 君主 / `general` 将领 / `prince` 宗室 / `minister` 名臣 / `consort` 后妃)。

返回 `{ items, total, next }`:`next` 是下一页的 `offset`,取完了是 `null`。每项 `PersonInfo`:`id`、`key`、`name`、`role`、`polity`、`born`、`died?`、`from?`(君主即位、名臣入仕)、`until?`、`title?`、`female?`。

### `history.events({ from?, to?, offset?, limit? })`

编年史 `[from, to]` 年里的条目,分页取,`limit` 最多 2000。编年史还没写好时回 `unavailable`。每项 `EventInfo`:`id`、`year`、`end`、`tag`(一个字的标签:立、战、亡……)、`text`(已经换好名字的一句话)、`importance`(1–3,3 是大事)、`polities`、`regions`、`settlement`(相关的城,没有是 −1)、`people?`。

## 你写的东西(`author.read@1`)

用的人自己的修改。这一行在权限框上单独列、标得很显眼。

| 调用 | 返回 |
|---|---|
| `author.marks()` | 标记:`[{ id, title, note?, color, size?, from, to?, at?, regions? }]`,`at` 是一个点 `[x, y]`(世界坐标),`regions` 是几个州的键 |
| `author.names()` | 改过的名字:`{ 稳定键: 名字 }` |
| `author.characters()` | 用的人放进世界的人物(格式同世界文件) |
| `author.interventions()` | 下过的命令(干预,格式见下面 `author.apply`) |
| `author.notes({ offset?, limit? })` | AI 写的正文,分页取,`limit` 最多 100;每项 `{ key, kind, title, text, createdAt }` |

## 改你写的东西(`author.write@1`)

### `author.apply({ changes })`

插件不能直接改世界,只能提一批要求,网站检查过再照办:

- 一次最多 200 条;**有一条不合格,整批都不改**(回 `bad-args` 或 `limit`,`message` 说是第几条)
- 照办的一整批记成一步撤销,网站顶上会说一声改了什么、给「撤销」
- 改的东西进了用的人自己的修改,和他自己改的一样:能分享、能存进文件,插件删了也还在
- 网站只检查改完的世界还能存、能打开,不替用的人判断改得对不对

返回 `{ applied, skipped, marks }`:`applied` 照办了几条,`skipped` 本来就是这样、没变的几条,`marks` 新加的标记的编号。

每条是下面三种之一:

**改名** `{ kind: 'name', key, name }`

- `key`:`history.*` 返回的稳定键(国家、城、州、民族、信仰、人物、地名都行)
- `name`:新名字;`null` 或空的 = 恢复原名。国家改的是国名词根:末尾的「国」「王国」「帝国」「王朝」这类会去掉,全称照当年的国号接上;民族末尾的「族」会去掉。去掉以后最长 16 个字,长了回 `limit`

**加标记** `{ kind: 'mark', mark: { title, note?, color, size?, from, to?, at | regions } }`

| 字段 | 规矩 |
|---|---|
| `title` | 名字,最长 40 个字;空的叫「新标记」 |
| `note` | 可选:说明,可以分行,最长 2000 个字 |
| `color` | `red` / `orange` / `green` / `blue` / `purple` / `teal`,或 `none`(不涂色) |
| `size` | 可选:`s` / `l` / `xl`(不给 = 中) |
| `from`、`to` | 时间轴在这几年里(两头都算)地图上才画它,0–65535 的整数年,`to` 不早于 `from`;`to` 不给 = 一直在 |
| `at` | 一个点 `[x, y]`(世界坐标,`y` 在 0 到 `height` 之间) |
| `regions` | 几个州的键(`history.regions()` 的 `key`),1–500 个;重复的只存一个 |

`at` 和 `regions` 只给一个。不合规的回 `bad-args`,名字、说明、州数超了回 `limit`,网站不替插件改。一个世界最多 2000 个标记,所有标记一共最多圈 10000 个州。

**下命令** `{ kind: 'intervention', v: { kind, from, ... } }`

`v` 和世界文件里的干预一个格式(类型是 [`types.ts`](../../src/plugin/types.ts) 里的 `InterventionInfo`),每种的意思和字段见 [`src/gen/edits.ts`](../../src/gen/edits.ts) 开头「干预」那一节的表。几个例子:

```js
{ kind: 'intervention', v: { kind: 'protect', a: polityKey, from: 300 } }              // 从 300 年起这国不会被灭
{ kind: 'intervention', v: { kind: 'ally', a: polityKey, b: otherKey, from: 300 } }   // 两国结盟
{ kind: 'intervention', v: { kind: 'declare', a: attackerKey, b: defenderKey, from: 420 } } // 420 年开战
```

网站不替插件改命令:年份要是 0–65535 的整数,`until` 要比 `from` 晚;多出来的字段、格式不对的键、超出范围的数、重复的州这类(用的人自己在页面上下命令时网站会悄悄整理掉的)都回 `bad-args`,`message` 说是哪个字段。立国的国名照改名的规矩去掉末尾的「国」这类,剩下的最长 16 个字,长了回 `limit`。取 0 的滑条、`false` 的开关当作没给,照收。`plot`、`guide`、方针的 `power`、`unrest`、`look`,和推演插件下的命令带的 `plugin`,交上来的会去掉。

照办以后网站从那一年起重新推演历史(之前的历史不变)。格式对、推演里做不到的命令照样记下,推完网站会说有几条没生效。一模一样的命令已经有了就算 `skipped`。

**出错码**:`bad-args`(有一条不合格)、`limit`(超过上限、改完存档太大)、`unavailable`(世界还没有历史:改名、下命令要等历史推出来;或网站这时还不能照办)、`blocked`(网站这时不让改,`message` 说为什么)、`busy`(一秒最多提 10 次)。

## 你在干什么(`view.read@1`)

### `view.get()`

```ts
{
  year,                                  // 时间轴停在哪一年
  selected: { kind, key?, id?, cell? } | null,  // 选中的东西
  visible: { x0, y0, x1, y1 } | null,    // 看得见的范围(世界坐标)
  layer: string | null,                  // 现在的填色或数据图层
}
```

变化用 `view.year`、`view.select` 两个事件听(见[基本](#civatlasonevent-fn))。

## 点选(`input.pick@1`)

请用的人在地图上点。鼠标、手指由网站处理,插件只拿到点完的结果,拿不到每一下移动;点的时候拖地图、缩放照常。

用的人在「工具」里点开一个工具,网站才开这个插件(顶层代码从头跑),所以插件一开好就可以请用的人点;关掉插件卡就停了,再点开是从头再跑一遍。请点的时候地图顶上有一条「插件 量路程:点起点」,写的是插件名和 `hint`。

| 调用 | 返回 |
|---|---|
| `pick.cell({ hint? })` | `{ cell }`:点了一个地块 |
| `pick.cells({ hint?, max? })` | `{ cells: Int32Array }`:点了几个地块,最多 `max` 个 |
| `pick.box({ hint? })` | `{ x0, y0, x1, y1, cells }`:拖了一个框,框住的地块 |

- `hint` 是写在地图顶上那一条里给用的人看的一句话,最长 40 个字
- 一次只能有一个点选,上一个没完再调回 `busy`
- 用的人按了顶上那条的「退出」或 Esc,回 `cancelled`
- 点完一次接着再请,顶上那条就一直在:量完一条路接着量下一条,用的人不想点了自己退出
- `pick.box` 再请时上一次的框还在,用的人可以挪、拖边角改大小,松手交来新的框;框只能在平面地图上画(地球仪、弯边投影会先切回平面)
- `pick.cells` 网站这一版还没开,回 `unavailable`

## 插件面板(`ui.panel@1`)

插件说面板上放什么,长什么样由网站画。卡片头(图标、名字、「插件」两个字、谁写的、关闭)是网站的,插件改不了。

### `panel.set({ nodes })`、`panel.clear()`

`panel.set` 整个换掉面板,`panel.clear` 拿掉。`nodes` 是下面这些格子的数组:

| `type` | 字段 | 是什么 |
|---|---|---|
| `heading` | `text` | 小标题 |
| `text` | `text` | 一段字,可以有换行 |
| `number` | `label`、`value`、`unit?` | 一个数,带名字和单位 |
| `table` | `columns`、`rows` | 表格,格子里是字或数 |
| `list` | `items` | 一串字 |
| `button` | `id`、`label`、`disabled?` | 按钮 |
| `select` | `id`、`label`、`options: [{ value, label }]`、`value?` | 下拉;`value` 和各项的 `value` 写法同 `id` |
| `slider` | `id`、`label`、`min`、`max`、`step?`、`value` | 滑块 |
| `toggle` | `id`、`label`、`value` | 开关 |
| `legend` | `items: [{ color, label }]` | 图例,颜色写成 `#rrggbb` |
| `divider` | — | 分隔线 |
| `progress` | `value`(0–1)、`label?` | 进度条 |
| `group` | `title?`、`children` | 一组,里面再放格子 |

上限:

- 一个面板最多 2000 个格子,字一共最多 4000 个;`group` 最多套 4 层
- 小标题、名字、按钮上的字、表格和列表里的一格最多 80 个字,`unit` 最多 16 个字
- 表格最多 500 行、20 列,列表最多 500 项,下拉最多 100 项,图例最多 32 项;表格的格子、列表的项、下拉的选项、图例加起来最多 20000 个
- 控件的 `id`:字母、数字、`-`、`_`,最长 32,一个面板里不能重
- 控制字符会去掉;除了 `text`,换行都换成空格

### 用的人动了控件

收到 `panel.action` 事件 `{ id, value? }`:按钮没有 `value`(按钮 `disabled` 时不发),开关是 `true` / `false`,下拉是选中那项的 `value`,滑块是数。值不合那个控件的不转给插件。要让面板跟着变(比如数字重算了),再 `panel.set` 一次。

```js
civAtlas.on('panel.action', ({ id, value }) => {
  if (id === 'mode') { mode = value; render(); }
});
```

## 图层(`layer.cells@1`、`layer.marks@1`)

插件交数据,网站来画:平面、弯边投影、地球仪、导出图片都自动支持。同一个 `id` 再交一次就是换掉。插件停了,它交的面板和图层一起拿掉。

- 地块图层在图层面板「插件图层」里一个图层一个按钮,同一时间显示一个,半透明盖在底图上(底图照旧能换),左上角是图例。第一次交来的地块图层,没有别的插件图层正显示时直接显示
- 标注图层交来就画在地图上,不进图层面板
- 只交图层的插件(没要 `ui.panel@1`、`input.pick@1`)不在「工具」里:图层面板里列着它的名字,点了才开这个插件,顶层代码从头跑;收起、换成别的插件的图层就停
- 用的人点图例上的「存进这个世界」,网站把这个地块图层**那一刻的样子**存进世界(网站认得的格式,不带插件的代码):以后插件更新了也不变,别人没装这个插件也看得到,能跟着世界公开分享。插件不用为此做什么,也读不到存着的那一份

### `layer.cells({ id, title, values, ramp | classes, legend?, opacity? })` — `layer.cells@1`

地块图层:每个地块一个数,和网站自己的「数据图层」(海拔、气温)一个画法。

| 字段 | 规矩 |
|---|---|
| `id` | 字母、数字、`-`、`_`,最长 32 |
| `title` | 最长 40 个字 |
| `values` | 数组或数值数组,个数等于地块数;`NaN`(和别的不是有限数的值)= 这块不画 |
| `ramp` | 渐变:`{ colors, min?, max? }`,2–16 个颜色,从 `min` 涂到 `max`(不给按数据的最小、最大) |
| `classes` | 分类:`[{ value, color, label }]`,1–32 类,值等于 `value`(整数)的地块涂这种颜色;`label` 最长 40 个字 |
| `legend` | 可选:图例的单位或说明,最长 40 个字 |
| `opacity` | 可选:0–1,不给是 0.65 |

`ramp` 和 `classes` 给且只给一个。颜色一律 `#rrggbb`。

### `layer.marks({ id, title, items })` — `layer.marks@1`

标注:点、文字、线、圈一片地块。每项:

| 字段 | 规矩 |
|---|---|
| `kind` | `point` 一个点 / `label` 一个点加文字 / `line` 一条线(按先后连)/ `area` 圈出几个地块 |
| `cells` 或 `points` | 位置给地块编号,或世界坐标 `[x0, y0, x1, y1, …]`(`x` 超出 0–`width` 的绕回来,`y` 要在 0–`height` 之间);`area` 只认 `cells` |
| `text` | 最长 40 个字;`label` 必须有 |
| `style` | 可选:`color`(`red` / `orange` / `green` / `blue` / `purple` / `teal` / `black` / `white`)、`line`(`solid` / `dashed`)、`size`(`s` / `m` / `l`) |

`point`、`label` 只能给一个位置,`line` 至少两个,`area` 至少一个。一个标注图层最多 5000 项,地块和点一共最多 200000 个。

### `layer.remove({ id })` — `layer.cells@1` 或 `layer.marks@1`

拿掉一个图层。

一个插件最多 4 个地块图层、4 个标注图层,第 5 个回 `limit`。一个 `id` 交过地块图层就不能再拿来交标注图层(反过来也一样)。

## 插件自己的数据(`store.local@1`、`store.world@1`)

| 调用 | 存在哪 | 最大 |
|---|---|---|
| `store.local.get()` / `set(data)` / `clear()` | 插件自己的设置,在这个浏览器里,所有世界共用一份,不在世界里 | 64 KB |
| `store.world.get()` / `set(data)` / `clear()` | 存进这个世界,跟着世界走 | 1 MB |

- `data` 是 `{ schema, value }`:`schema` 是你自己定的结构版本(正整数),以后改了存法靠它认新旧;`get()` 原样还回来,没存过是 `null`
- `value` 只能是:`null`、`true` / `false`、有限的数、字、数组(不能有空位)、普通对象、数值数组(Float32Array 这类,BigInt 的不行);最多套 32 层,不能绕成圈,不能用 `__proto__`、`constructor`、`prototype` 当键
- 每个世界第一次 `store.world.set` 时(这个世界里还没有你的数据),网站先问用的人一句:点「存进这个世界」才存,点「这次不存」回 `cancelled`,这次打开里不再问、再存也回 `cancelled`。存过以后不再问;用的人在「存档」里去掉了你的数据,下次存又会问。`clear()` 和 `get()` 不问
- 世界还没存进用的人的「我的世界」时,网站先把它存下来再写
- 开发者模式里载入的插件照旧只存在内存里,不问。`store.local` 照常能用
- **存了 `store.world` 的世界不能公开分享**(网站不解开插件的数据,没法检查里面写了什么),还能存成文件发给别人;用的人在「存档」里能「去掉插件存的数据」。装插件时权限框上这一行下面写明这个后果,能不存就不存
- 别人没装你的插件打开这个世界,数据原样留着,打开时顶上会说一句「用到了你没装的插件…」,世界设定里列着用到了哪些插件

## 出错码

| `code` | 意思 |
|---|---|
| `no-permission` | 清单里没要这样能力 |
| `unknown-call` | 没有这个调用 |
| `bad-args` | 参数不对(`message` 说哪里不对);参数里有传不过去的东西(函数之类)也是它 |
| `limit` | 超过上限 |
| `unavailable` | 现在拿不到:还没打开世界、还没有历史、编年史还没写好、网站这边还没开这个功能 |
| `busy` | 正忙:取数太快、同时没回的调用太多、上一次点选还没完、提修改太快 |
| `blocked` | 网站这时不让改 |
| `cancelled` | 用的人取消了(比如退出了点选) |
| `failed` | 网站这边出错 |

```js
try {
  const { cell } = await civAtlas.pick.cell({ hint: '点起点' });
} catch (e) {
  if (e.code === 'cancelled') return;   // 用的人不点了
  civAtlas.log('出错了', e.code, e.message);
}
```

各种上限汇总、插件什么时候会被停掉,见[能力、权限和限制](limits.md)。
