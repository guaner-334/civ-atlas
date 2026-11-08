# 地图插件(第 1 版)

地图插件在长地图的时候出手:改海拔(砸几个陨石坑、把海平面抬高)、改气候(季风让东岸多下雨)、交几张图层(柯本气候分类、潮差)。插完手,后面的步骤照常走:坑里积水成湖,雨多的地方长出河和森林,文明照新的地图长。长好的地图和图层存进世界,别人没装插件也照样能看。

> **地图插件还没开放。** 网站上还不能装地图插件、拿它新建世界;这一页照接口第 1 版写,开放以后照这里写的用。开放之前接口的细节还可能调整,调整了会改这一页。现在可以在这个仓库里打包、试跑(见[十分钟写一个地图插件](#十分钟写一个地图插件))。

示例在 [`examples/plugins/`](../../examples/plugins/),拷走改改就能用:

| 示例 | 做什么 | 用到 |
|---|---|---|
| [环形山](../../examples/plugins/craters/) | 砸出几十个陨石坑,坑底下陷、坑沿隆起,陆地上的坑积水成湖;滑条:坑有几个、多大 | 改海拔、随机数、帮手 `noise`、`near`、`km` |
| [柯本气候](../../examples/plugins/koppen/) | 季风让副热带东岸多下雨;再估出每块陆地 12 个月的气温和降水,分成柯本的 30 类,画成分类图层;滑条:季风强弱 | 改气候、出图层(分类)、帮手 `steps` |
| [潮汐](../../examples/plugins/tides/) | 按大陆架多宽、海湾多封闭算近岸的潮差,画成渐变图层;不改地图 | 出图层(渐变)、邻接表、帮手 `steps` |

## 和别的插件有什么不一样

| | 工具插件 | 推演插件 | 地图插件 |
|---|---|---|---|
| 清单的 `role`、`runtime` | `"tool"`、`"worker"` | `"sim"`、`"quickjs"` | `"map"`、`"quickjs"` |
| 什么时候跑 | 用的人点开它的时候,对着长好、推好的世界 | 推演推到它出手的那一刻 | 长地图的时候:新建世界、改地形、换参数重新长 |
| 跑在哪 | 网站页面里隔开的后台线程 | 推演线程里的 QuickJS | 生成线程里的 QuickJS(和推演是同一个线程、同一份 QuickJS) |
| 接口 | `civAtlas.world.cells(…)` 这类调用,返回 Promise | `civAtlas.sim({ act(turn) { … } })` | `civAtlas.map({ height(d) { … }, climate(d) { … }, layers(d) { … } })` 登记几个函数,长到那一步时调,当场交回 |
| 结果 | 面板、图层只在用的时候显示 | 进历史 | 进地图:同一个种子、同样的参数和修改、同一套地图插件和滑条,在哪长都是同一张图 |

地图插件不能换掉官方的生成步骤,只能在官方开的三个口子上改数、交图层。

## 十分钟写一个地图插件

下面写一个「海平面升降」:全世界的海平面抬高或降低几百米。

**1. 建一个文件夹**,比如 `my-sealevel/`,放四个文件:`plugin.json`、`main.js`、`README.md`、`LICENSE`(和工具插件一样,见[插件开发](README.md#十分钟写一个插件))。

**2. 写 `plugin.json`:**

```json
{
  "id": "sealevel",
  "name": "海平面升降",
  "version": "1.0.0",
  "role": "map",
  "api": 1,
  "runtime": "quickjs",
  "requires": ["gen.height@1"],
  "why": { "gen.height@1": "全世界的海平面抬高或降低几百米" },
  "map": {
    "stages": ["height"],
    "params": {
      "rise": { "label": "海平面升高（米）", "min": -500, "max": 500, "default": 200, "step": 50 }
    }
  },
  "description": "全世界的海平面抬高或降低几百米：抬高了，海边的低地被淹；降低了，大陆架露出来。",
  "license": "MIT",
  "author": { "name": "你的名字" }
}
```

`map` 段是地图插件的设定:在「改海拔」这一步出手,新建世界时有一个滑条。`requires` 里写用到的能力:改海拔 `gen.height@1`。

**3. 写 `main.js`:**

```js
civAtlas.map({
  height(d) {
    // 海平面抬高 rise 米 = 每块地都矮 rise 米
    const rise = d.params.rise;
    const e = d.elevation.slice();
    for (let i = 0; i < d.n; i++) e[i] -= rise;
    return { elevation: e };
  },
});
```

插件代码顶层调一次 `civAtlas.map`,给它一个对象,清单 `map.stages` 写了哪几步就放哪几个函数。长到「改海拔」这一步,网站调 `height(d)`:`d` 是递进来的数据(每个地块的海拔、海陆……)和几样帮手;交回的对象里是改好的海拔。海拔跨过 0 米的地块,网站自己把它改成陆地或海;后面的湖、气候、河、群落都照改过的海拔算。函数要当场交回,不能是 `async`。

**4. 写 `README.md` 和 `LICENSE`**,同工具插件。

**5. 打包、试跑。** 需要这个仓库的代码和 Node 22 以上:

```bash
pnpm install
npx tsx scripts/pack-plugin.ts path/to/my-sealevel            # 写出 path/to/my-sealevel/sealevel.civplugin
npx tsx scripts/map-plugin-try.ts path/to/my-sealevel         # 种子 7 长一张图,和不带插件的比一比
npx tsx scripts/map-plugin-try.ts path/to/my-sealevel seed=2024 rise=-300 years=3000
```

试跑用的是和网站同一份 QuickJS、同一套检查和叫停线,打印:每一口用了多久;插件里 `console.log` 的;几样统计(陆地占多少、湖、河、陆地最高处、平均气温和降水、各群落占陆地多少,不带 → 带插件);每张图层有值的地块和范围(分类图层数每一类有多少);给了 `years` 再推这么多年,看长不长得出文明。插件出错停下的,打印那句错。几个插件一起试,把它们按出手的先后都写上;滑条交给清单里有这个名字的插件。

编辑器提示:在这个仓库里打开 `examples/plugins/` 下的文件,编辑器照 [`civ-atlas-map.d.ts`](../../examples/plugins/civ-atlas-map.d.ts) 给出 `d` 上每一样的补全和类型检查。在别处写插件,把这个文件拷过去(它不依赖别的文件),照 [`civ-atlas.d.ts`](../../examples/plugins/civ-atlas.d.ts) 的写法声明全局的 `civAtlas`,类型写 `CivAtlasMap`。

## 三个口子

长一张图分好几步:撒地块 → 板块(哪里是陆地、哪里隆起)→ 造山、雨水冲出河谷 → 定海拔(换算成米,挖裂谷和小洼地)→ 积水成湖 → 洋流、风、气温、降水 → 海冰、河、群落 → 铺成地图。地图插件能在其中三处插手:

| 口子 | `map.stages` 写 | 在哪一步 | 拿到(每一口都有的另见下面) | 能交回 | 后面跟着变的 |
|---|---|---|---|---|---|
| 改海拔 | `height` | 定海拔之后、积水成湖之前 | 海拔、海陆、板块 | 海拔,可选海陆 | 湖、气候(山挡雨)、河、群落、文明 |
| 改气候 | `climate` | 气温、降水算完之后,海冰、河之前 | 海拔、海陆湖、气温、降水、风向、夏半年和冬半年各下多少雨 | 气温、降水 | 海冰、河、群落、文明 |
| 出图层 | `layers` | 最后,地图长好以后 | 上面所有,加湖面、海冰、群落、径流、河 | 最多 4 张图层 | 不改地图 |

```ts
/** 每一口当场交回;什么都不交 = 这一口不改 */
export interface MapPluginDef {
  /** 改海拔:定海拔之后、湖和气候之前 */
  height?(d: HeightInput & MapParams): HeightReply | void;
  /** 改气候:气温降水算完之后、海冰河流群落之前 */
  climate?(d: ClimateInput & MapParams): ClimateReply | void;
  /** 出图层:地图长好以后,只看不改 */
  layers?(d: LayersInput & MapParams): LayersReply | void;
}
```

几件要知道的:

- **几个插件按先后出手**:一个世界用了几个地图插件,每一口里按选的先后出手,前一个插件交回的套上了才轮到下一个,下一个拿到的是改过的
- **你最后动手**:你在地形编辑里涂的高低、挖的湖、画的河在「改海拔」之后才套上,涂的冷暖干湿在「改气候」之后才套上:插件改了什么,你涂的照样算数。你放的火山、山脉、抬起沉下在更早的步骤里(要经过雨水冲刷),插件拿到的海拔里已经有它们
- **改一笔地形,哪几口重跑**:改海拔那一口在「前一半」里,只有换参数、改草图、放火山山脉抬起沉下才重跑;改气候、出图层每涂一笔都重跑
- **每一口一个新环境**:每一口网站都新开一个干净的 QuickJS 环境,插件代码从头跑一遍,再调这一口的函数。顶层的变量带不到下一口,也别想靠它记「上一次长图」的东西:改一笔地形时改海拔不重跑、改气候重跑,靠全局变量传东西,就和从头长对不上了。两口都要用的数,各自重新算(帮手很快)
- **拿到的都是复制的一份**:改了 `d` 上的数组也不碰世界,要改就交回
- **交回 `undefined`**(或者什么都不 `return`)就是这一口不改

## 每一口都递的

| `d.` 上的 | 是什么 |
|---|---|
| `n` | 地块数。默认 3 万多块,一块约 130 公里宽;新建世界时能调成 2000 到 20 万块 |
| `lat`、`lon` | 每块的纬度、经度(度;北纬、东经是正的) |
| `xyz` | 每块在单位球面上的位置,交错存 x, y, z(长 3n) |
| `adjStart`、`adj` | 邻接表:地块 i 的邻居是 `adj[adjStart[i]]` 到 `adj[adjStart[i + 1] - 1]` |
| `kmPerUnit` | `xyz` 的一个单位(星球半径)合多少公里;现在星球和地球一样大,约 6366 |
| `seed` | 地图种子 |
| `params` | 滑条拨到几,只读,和 `civAtlas.params` 是同一份(见[滑条](#滑条)) |
| `rand(a, b, c)` | 随机数(见[随机数](#随机数)) |
| `noise`、`blur`、`steps`、`near`、`km` | 帮手(见[帮手](#帮手)) |

### 改海拔(`height`)

| `d.` 上的 | 是什么 |
|---|---|
| `elevation` | 海拔(米),海平面是 0 |
| `land` | 1 陆地 / 0 海(这时还没有湖) |
| `plate` | 属于第几块板块 |

交回 `{ elevation, land }`,两样都可以不给:

- `elevation`:每块的新海拔(米),压到 −11000 到 9000 米
- 不给 `land`:海拔改过的地块,高过 0 米的成了陆地、不高于 0 米的成了海(和地形编辑里的高度笔一个规矩);海拔没改的地块海陆不变
- 给了 `land`:每块 0 或 1,照它定海陆,不看海拔
- 在内陆挖到海平面以下,那里就是海(四面是陆地的内海),不是湖。想要湖,挖到 0 米以上就停:陆地上四面高、中间低的地方后面会积水成湖(比水面低 3 米以上的才算湖,太大的一整片会被填平)

### 改气候(`climate`)

| `d.` 上的 | 是什么 |
|---|---|
| `elevation` | 海拔(米) |
| `water` | 0 陆地 / 1 海 / 2 湖 |
| `temperature` | 年平均气温(°C) |
| `precipitation` | 年降水(毫米) |
| `windX`、`windY` | 盛行风的方向,单位向量:`windX` 往东是正的,`windY` 往南(地图上往下)是正的 |
| `rainSummer`、`rainWinter` | 夏半年、冬半年按一整年算的降水(毫米 / 年),年降水是两者的平均:分得出哪里夏雨、哪里冬雨 |

交回 `{ temperature, precipitation }`,都可以不给:气温压到 −70 到 50 °C,降水压到 0 到 15000 毫米。夏冬两半的降水只给插件看,不收。

下面这个「内陆更干」让离海越远的陆地雨越少:

```json
{
  "id": "dryinland",
  "name": "内陆更干",
  "version": "1.0.0",
  "role": "map",
  "api": 1,
  "runtime": "quickjs",
  "requires": ["gen.climate@1"],
  "why": { "gen.climate@1": "离海越远的陆地雨越少" },
  "map": {
    "stages": ["climate"],
    "params": {
      "dry": { "label": "腹地少几成雨", "min": 0, "max": 0.8, "default": 0.4, "step": 0.1 }
    }
  },
  "description": "离海越远的陆地雨越少，大陆腹地多出草原和荒漠。",
  "license": "MIT",
  "author": { "name": "你的名字" }
}
```

```js
civAtlas.map({
  climate(d) {
    // 海标 1(湖不算),每块离海几步
    const sea = new Uint8Array(d.n);
    for (let i = 0; i < d.n; i++) sea[i] = d.water[i] === 1 ? 1 : 0;
    const far = d.steps(sea);
    const p = d.precipitation.slice();
    for (let i = 0; i < d.n; i++) {
      if (d.water[i] !== 0) continue;
      // 离海 15 步(默认地块数时约 2000 公里)以外少到底
      p[i] *= 1 - d.params.dry * Math.min(1, far[i] / 15);
    }
    return { precipitation: p };
  },
});
```

### 出图层(`layers`)

改气候那一口的都有,另外:

| `d.` 上的 | 是什么 |
|---|---|
| `plate` | 属于第几块板块 |
| `waterLevel` | 湖面多高(米,只有湖有意义) |
| `seaIce` | 海冰盖了多少(0–1) |
| `biome` | 群落编号;`biomeNames[编号]` 是它的名字(海洋、湖泊、海冰、冰原、苔原、针叶林……) |
| `flux` | 径流:上游汇来多少水,超过 `riverThreshold` 的地块成河 |
| `riverCells`、`riverStart` | 河:第 k 条河从源头往下游经过的地块是 `riverCells[riverStart[k]]` 到 `riverCells[riverStart[k + 1] - 1]` |

这一口只看不改,交回 `{ layers: { 图层编号: 每块一个数 } }`,见[图层](#图层)。

## 随机数

`d.rand(a, b, c)` 是 [0, 1) 的数,只由地图种子、插件编号和 a、b、c 三个整数定(不给当 0,小数部分去掉)。同样的 a、b、c 永远是同一个数,和调的先后无关:环形山第 k 个坑用 `d.rand(k, 1)` 定在哪、`d.rand(k, 2)` 定多大、`d.rand(k, 3)` 定多深。换一个插件编号,同一个种子得到另一串数。

## 帮手

网站替插件算的几样,结果只由地图种子、插件编号和参数定,在哪台设备上都一样。在 QuickJS 里自己写这些要慢几十倍。

| 帮手 | 交回 | 参数 |
|---|---|---|
| `d.noise({ km, octaves, persistence, salt })` | 每块一个 −1 到 1 左右的数(`Float32Array`),和官方长地形用的同一套噪声 | `km`:大约多远一个起落(公里,大于 0);`octaves`:叠几层,1–8 的整数,默认 1,每多一层尺度减半;`persistence`:每多一层起伏乘多少,大于 0、不超过 1,默认 0.5;`salt`:同一个插件要几张不一样的噪声时各给一个,最长 64 个字的字,或者一个数 |
| `d.blur(field, passes, mask)` | 每块和邻居平均 `passes` 遍(`Float32Array`) | `field`:每块一个数;`passes`:0–200 的整数;`mask` 可选:只在标了 1 的地块上平均、只和标了 1 的邻居平均,别的地块不变 |
| `d.steps(from, through)` | 从 `from` 沿邻居走过来,每块要走几步(`Int32Array`),走不到是 −1 | `from`:标了 1 的是起点;`through` 可选:只能走进标了 1 的地块(起点不受它管) |
| `d.near(cell, km)` | 离地块 `cell` 不超过 `km` 公里的地块(`Int32Array`,含它自己,编号从小到大) | `cell`:地块编号;`km`:不小于 0 |
| `d.km(a, b)` | 两块之间多少公里(直线穿过星球的距离,近处和沿地面走差不多) | `a`、`b`:地块编号 |

- `mask`、`from`、`through` 只认等于 1 的格子,2 也不算:`water` 那种 0 / 1 / 2 要先换成 0 和 1。`field`、`mask`、`from`、`through` 的长度都要等于地块数,给普通数组的每一格都要是数
- 噪声的种子按插件编号和 `salt` 分开:两个插件,或者同一个插件给两个 `salt`,得到的噪声互不相干
- 参数写错了抛错,说是哪个帮手、哪一项(`d.noise 的 km 要是大于 0 的数`);插件没接住,就是这一口出错
- `noise`、`blur`、`steps`、`near` 要把数据递出 QuickJS 再拿回来,一次几毫秒以内;`rand`、`km` 就在 QuickJS 里算。几千块的地方各调一次 `d.near` 也不贵,每块调一次就慢了

下面这个「丘陵起伏」给陆地加上一片片丘陵(丘陵之间的洼地后面会积成小湖),用了噪声和只在陆地上的平滑:

```json
{
  "id": "hills",
  "name": "丘陵起伏",
  "version": "1.0.0",
  "role": "map",
  "api": 1,
  "runtime": "quickjs",
  "requires": ["gen.height@1"],
  "why": { "gen.height@1": "给陆地加上一片片丘陵" },
  "map": {
    "stages": ["height"],
    "params": {
      "hill": { "label": "丘陵多高（米）", "min": 0, "max": 1500, "default": 600, "step": 100 }
    }
  },
  "description": "给陆地加上一片片丘陵：平原上起伏多了，高山不动。",
  "license": "MIT",
  "author": { "name": "你的名字" }
}
```

```js
civAtlas.map({
  height(d) {
    // 约 600 公里一片,叠 4 层;只要鼓起来的那一半
    const wave = d.noise({ km: 600, octaves: 4, salt: 'hills' });
    const bump = new Float32Array(d.n);
    for (let i = 0; i < d.n; i++) bump[i] = d.land[i] ? Math.max(0, wave[i]) * d.params.hill : 0;
    // 只在陆地上平滑 3 遍,海边不被海拉平
    const soft = d.blur(bump, 3, d.land);
    const e = d.elevation.slice();
    // 越高的地方加得越少,3000 米以上不加
    for (let i = 0; i < d.n; i++) {
      if (d.land[i] && e[i] > 0) e[i] += soft[i] * Math.max(0, 1 - e[i] / 3000);
    }
    return { elevation: e };
  },
});
```

## 图层

清单 `map.layers` 登记交哪几张(`map.stages` 里要写 `layers`、`requires` 里要有 `gen.layers@1`),出图层那一口交回 `{ layers: { 编号: 每块一个数 } }`。潮汐示例登记的那张:

```json
{
  "id": "tide",
  "title": "潮差",
  "ramp": { "colors": ["#ffffb2", "#fecc5c", "#fd8d3c", "#e31a1c"], "min": 0.5, "max": 2 },
  "legend": "米",
  "opacity": 0.9
}
```

- `id`:图层编号,小写字母开头,小写字母、数字、下划线,最长 32 个字,不重复
- 样子和工具插件的地块图层同一套写法:`title`(最长 40 个字);`ramp`(渐变,2–16 色,`min`、`max` 不写按数据定)和 `classes`(分类,1–32 类,`{ value, color, label }`)给且只给一个;可选 `legend`、`opacity`(0–1,不给按 0.65)。网站怎么画见[存进世界的图层](layer-format.md#怎么画)
- 交回的数组长度等于地块数,存成 32 位的小数;`NaN` 的地块不画,不能有无穷大和不是数的。分类图层的数等于某一类 `value` 的涂那一类的颜色,哪一类都不是的不画
- 只收清单里登记过的编号,一个插件最多 4 张;登记了、这一次没交的那张就没有
- 网站长地图时把图层存进世界(地块图层,格式见[存进世界的图层](layer-format.md)),跟着地图走:改了地形重算、整批换掉。看世界的人没装插件也看得到,在图层面板的「插件图层」里开关

下面这个「离河多远」画出每块陆地离最近的河有多远,用了河、邻接表和 `d.km`:

```json
{
  "id": "riverside",
  "name": "离河多远",
  "version": "1.0.0",
  "role": "map",
  "api": 1,
  "runtime": "quickjs",
  "requires": ["gen.layers@1"],
  "why": { "gen.layers@1": "画出每块陆地离最近的河有多远" },
  "map": {
    "stages": ["layers"],
    "layers": [
      {
        "id": "river_km",
        "title": "离河多远",
        "ramp": { "colors": ["#08519c", "#6baed6", "#fee391", "#cc4c02"], "min": 0, "max": 800 },
        "legend": "公里"
      }
    ]
  },
  "description": "画出每块陆地离最近的河有多远。",
  "license": "MIT",
  "author": { "name": "你的名字" }
}
```

```js
civAtlas.map({
  layers(d) {
    // 河经过的地块标 1;只在陆地上走
    const river = new Uint8Array(d.n);
    for (let k = 0; k < d.riverCells.length; k++) river[d.riverCells[k]] = 1;
    const land = new Uint8Array(d.n);
    for (let i = 0; i < d.n; i++) land[i] = d.water[i] === 0 ? 1 : 0;
    const steps = d.steps(river, land);
    // 一步平均多少公里:每块到它头一个邻居的距离取平均
    let sum = 0;
    for (let i = 0; i < d.n; i++) sum += d.km(i, d.adj[d.adjStart[i]]);
    const stepKm = sum / d.n;
    const out = new Float32Array(d.n).fill(NaN);
    for (let i = 0; i < d.n; i++) if (land[i] && steps[i] >= 0) out[i] = steps[i] * stepKm;
    return { layers: { river_km: out } };
  },
});
```

## 滑条

清单 `map.params` 给新建世界时拨的滑条,插件里读 `d.params.<名字>` 或 `civAtlas.params.<名字>`(只读)。规矩和推演插件的一样:最多 8 个,名字用字母、数字、下划线(不以数字开头,最长 32 个字),每个写 `label`(最长 12 个字)、`min`、`max`、`default`,可选 `step`。网站照清单补齐没拨的、压进 `min`–`max`,插件拿到的每个滑条都有数。环形山的两个:

```json
{
  "count": { "label": "坑有几个", "min": 0, "max": 200, "default": 40, "step": 1 },
  "size": { "label": "坑多大", "min": 0.5, "max": 2, "default": 1, "step": 0.1 }
}
```

拨到几记进世界。改了滑条长出来是另一张图,和换了插件一样。

## 能力和权限框

地图插件能要的能力(都只给地图插件,工具插件、推演插件要不了):

| 能力 | 能用的 | 权限框上那一行 |
|---|---|---|
| `gen.height@1` | `map.stages` 写 `height`,`height(d)` | **会改地图（海拔、气候；只影响用它新长的地图，已经长好的世界不变）**,显眼 |
| `gen.climate@1` | `map.stages` 写 `climate`,`climate(d)` | 同上一行 |
| `gen.layers@1` | `map.stages` 写 `layers`,`layers(d)`,清单 `map.layers` | 在地图上加图层和标注 |

`map.stages` 写了哪一步,`requires` 里就要有那一步的能力,打包时就查;没写的那几步的能力别要,权限框上会白白多一行。地图插件的权限框最底下一行是:

> 它不能联网、看不到你的 AI 密钥和账号、看不到别的世界、改不了历史和推演规则。

权限框上的字以网站上显示的为准。

## QuickJS 里没有什么

地图插件和推演插件跑在同一种 QuickJS 里:只有 JS 语言本身(`Array`、`Map`、`Math`、`JSON`、类型化数组……)和 `civAtlas`。为了同一个种子在哪里长都是同一张图、跑的代码和审过的一样,这几样用了就报错:

- `Date`(包括 `Date.now()`):地图不能跟着现实的时间变
- `Math.random()`:要随机数用 [`d.rand`](#随机数)
- `eval`、`Function` 构造器(包括 `async`、生成器函数的构造器)

这些本来就没有:`fetch` 和一切联网、`setTimeout` 等定时器、`Worker`、`WebAssembly`、`Atomics`、`Intl`、`TextEncoder`、`structuredClone`、`self`、`postMessage`、`importScripts`。用到的库直接写进 `main.js`(普通脚本,不能 `import`)。

`Math.sin`、`Math.exp` 这些在 QuickJS 里算,哪台设备上都是同一个数,不用自己舍入。示例里的 `r24` 是为了同一份代码不经 QuickJS 直接跑也逐位一样(测试要用),写自己的插件可以不要。

`console.log`、`console.warn` 这些可以留在代码里,长地图时什么都不做,也不出错;用试跑脚本试时打印出来,带插件编号和哪一口。

## 上限

| 项目 | 上限 | 超了 |
|---|---|---|
| 插件文件 | 同工具插件:2 MB;`main.js` 1 MB | 装不上 |
| 一个世界的地图插件 | 4 个 | 选不了更多 |
| 一口用时 | 一个插件 5 秒(连同开环境、跑顶层代码) | 生成停下 |
| 一次生成的用时 | 所有地图插件加起来 15 秒 | 生成停下(算用得最多的那个) |
| 内存 | 一个插件的 QuickJS 64 MB | 生成停下 |
| 调用套的深度 | QuickJS 的栈 64 KB | 生成停下 |
| 交回的数 | 海拔 −11000 到 9000 米,气温 −70 到 50 °C,降水 0 到 15000 毫米 | 压到范围里 |
| 图层 | 一个插件 4 张;渐变 2–16 色,分类 1–32 类 | 打包时 / 生成停下 |
| 滑条 | 8 个,`label` 12 个字 | 打包时就报 |
| 帮手 | `noise` 最多叠 8 层、`salt` 64 个字;`blur` 最多 200 遍 | 这一口出错 |

一次生成:新建世界、换参数重新长是一次;改一笔地形也是一次(只重跑改气候、出图层)。

## 出错了会怎样

插件抛出没接住的错、交回的不对(长度不是地块数、有不是有限的数、`land` 不是 0 或 1、交了没登记的图层、交回 Promise 或函数)、超时、内存或栈用完,这一次生成停下,报出是哪个插件、哪一口、什么错,比如:

> 地图插件「sealevel」在改海拔这一步出错:elevation[0] 不是有限的数

插件代码顶层出错、没调 `civAtlas.map`、清单写了的那一步没有函数,是装不上:「地图插件「sealevel」装不上:……」。用试跑脚本看得到同一句话。

网站上会说清是哪个插件、哪一口出错,可以不带它重新长。已经长好的世界不受影响。

## 看、推历史、改地形要不要装

长好的地图和图层都存在世界里,所以:

| 想做的 | 装着同一版 | 没装 / 装的是别的版本 |
|---|---|---|
| 看地图、历史、插件的图层 | 照常 | 照常 |
| 推历史:改过去、再推、逐年推演…… | 照常 | 照常:地图存着,推历史用不着再长地图 |
| 改地形、加地形大事、换参数重新长 | 照常,插件跟着重跑 | 要先装同一版;只装了新版的,可以另存一份照新版重新长(地图会变,历史从第 0 年重推) |

改过地形(地形修改、草图)的世界,推历史要照「没改地形时那颗星球」定扩张快慢、沿用山海湖岛的地名。那颗星球也是插件长的,网站存世界时顺手把这两样一起存下,没装插件推历史就用存下的。只有一处例外:地名风格、拓荒、起源、规则、文明种子改了以后重推,存下的地名对不上,要先装同一版。

世界里记着用了哪几个地图插件(编号、版本、文件指纹、滑条拨到几)和它们的先后。同一张图 = 种子 + 参数 + 你的修改 + 生成器第几版 + 这一串地图插件:换一样、少一样都可能是另一张图。所以配方链接里没有插件,用了地图插件的世界要分享就发世界文件或短链接。

## 写快一点

QuickJS 是解释着跑的,比浏览器直接跑慢几十倍。两招:

- **沿邻居走,别每次扫全图**:要找附近的地块,用 `d.near` 或者从邻接表一圈圈往外走(潮汐示例找海湾那样),不要对每个点把全图扫一遍
- **能用帮手就用帮手**:噪声、平滑、离某处几步网站算好递进来

在电脑上量过的数(默认 3 万多块,在 QuickJS 里):

| 写法 | 多久 |
|---|---|
| 环形山 40 个坑,每个坑扫一遍全图 | 0.15–0.34 秒 |
| 环形山 40 个坑,只看坑附近(`d.near`) | 0.002–0.01 秒 |
| 自己写 5 层噪声 | 约 0.5 秒 |
| `d.noise` 5 层 | 约 0.008 秒 |
| 自己平滑 20 遍 | 约 0.14 秒 |
| `d.blur` 20 遍 | 约 0.003 秒 |
| `d.steps` 离海几步 | 0.003 秒以内 |
| 柯本气候示例(12 个月、30 类) | 0.08–0.11 秒 |
| 潮汐示例 | 0.06–0.09 秒 |

20 万块大约慢 5–6 倍,手机上再慢 4–6 倍。一口最好别超过 1 秒。试跑脚本会打印每一口用了多久。

## 写地图插件时照着查

这几条写插件时自己对一遍;作品墙收地图插件以后,审核也看这些:

- 做的和清单、README 里说的一致,`why` 写清改什么、为什么
- 能力没多要:`requires` 只写 `map.stages` 里那几步的能力
- **随机数只用 `d.rand`**,不靠 `Date`、`Math.random`(反正用不了)
- **每一口是新环境,别用全局变量记东西**:全局变量只放常数、函数
- **沿邻居走、用帮手**,别每次扫全图,别自己写噪声
- 同一个种子、同一套插件和滑条长两遍,一模一样
- 图层的字合规,不显示不合适的内容
- 代码是人能读的,不压缩、不混淆
- 种子 7、2024 各长一遍(`scripts/map-plugin-try.ts`),再推 3000 年(`years=3000`),看统计、图层和长出来的文明是不是你想要的
