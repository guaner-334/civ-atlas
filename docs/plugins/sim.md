# 推演插件(第 1 版)

推演插件在推演里跑:每隔几年出手一次,看此刻的世界,交几样数影响官方的决定(城能长多大、哪国更爱打仗……),下命令(宣战、结盟、立约……),写编年史,记自己的新数值(魔力、信仰的热度……)并存成图层。推出来的历史和官方的一样存进世界,别人没装插件也照样能看。

> **推演插件还没开放。** 网站上还不能装推演插件、拿它新建世界;这一页照接口第 1 版写,开放以后照这里写的用。开放之前接口的细节还可能调整,调整了会改这一页。现在可以在这个仓库里打包、试跑(见[十分钟写一个推演插件](#十分钟写一个推演插件))。

示例在 [`examples/plugins/`](../../examples/plugins/),拷走改改就能用:

| 示例 | 做什么 | 用到 |
|---|---|---|
| [厌战](../../examples/plugins/weariness/) | 有议会的国家开战要先过议会;久攻不下、打得太久的仗,议会遣使议和 | 读口、听史事、小本子、影响口、命令、编年史 |
| [宗教生效](../../examples/plugins/faith/) | 异教的州难治、难融合,异教邻国更容易开战;圣城被异教国占了就兴兵去夺,同教的小国联手对付异教强邻 | 读口、小本子、随机数、三个影响口、两种命令、编年史 |
| [魔力](../../examples/plugins/magic/) | 每州一个魔力浓度,从灵脉涌出、向邻州漫开、被人耗掉;魔力浓的州城的人口上限高 | 自己的表、接官方表、图层、影响口、滑条 |

## 和工具插件有什么不一样

| | 工具插件 | 推演插件 |
|---|---|---|
| 清单的 `role`、`runtime` | `"tool"`、`"worker"` | `"sim"`、`"quickjs"` |
| 什么时候跑 | 用的人点开它的时候,对着推好的世界 | 推演推到它出手的那一刻,和推演一起跑 |
| 跑在哪 | 网站页面里隔开的后台线程 | 推演线程里的 QuickJS(一个只有 JS 语言本身的小解释器) |
| 接口 | `civAtlas.world.cells(…)` 这类调用,返回 Promise | `civAtlas.sim({ act(turn) { … } })` 登记一个函数,推演每回合调它,当场交回 |
| 结果 | 面板、图层只在用的时候显示;改你写的东西要提要求 | 进历史:同一个种子、同一套插件和滑条,在哪推都是同一段历史 |

推演插件不能改推演的规则本身,只能在官方开的几个口子上交数、下命令、加自己的数。

## 十分钟写一个推演插件

下面写一个「港口兴旺」:临海的州,城的人口上限高一些。

**1. 建一个文件夹**,比如 `my-harbor/`,放四个文件:`plugin.json`、`main.js`、`README.md`、`LICENSE`(和工具插件一样,见[插件开发](README.md#十分钟写一个插件))。

**2. 写 `plugin.json`:**

```json
{
  "id": "harbor",
  "name": "港口兴旺",
  "version": "1.0.0",
  "role": "sim",
  "api": 1,
  "runtime": "quickjs",
  "requires": ["sim.read@1", "sim.events@1", "sim.influence@1"],
  "why": { "sim.influence@1": "临海的州，城的人口上限高一些" },
  "sim": {
    "every": 20,
    "influences": ["city.capacity"],
    "params": {
      "bonus": { "label": "临海的城大几成", "min": 0, "max": 1, "default": 0.3, "step": 0.1 }
    }
  },
  "description": "临海的州，城的人口上限高一些。",
  "license": "MIT",
  "author": { "name": "你的名字" }
}
```

`sim` 段是推演插件的设定:每 20 年出手一次,交数给影响口 `city.capacity`(城的人口上限倍数),新建世界时有一个滑条。`requires` 里写用到的能力:读州的数据 `sim.read@1`、按频率出手 `sim.events@1`、交给影响口 `sim.influence@1`。

**3. 写 `main.js`:**

```js
civAtlas.sim({
  act(turn) {
    const { coastal } = turn.read.regions();
    const cap = turn.influence('city.capacity');
    for (let r = 0; r < cap.length; r++) cap[r] = coastal[r] ? 1 + civAtlas.params.bonus : 1;
    return { influences: { 'city.capacity': cap } };
  },
});
```

插件代码顶层调一次 `civAtlas.sim`,给它一个带 `act` 的对象。推演每到插件出手的那一刻调 `act(turn)`:`turn` 是这一回合(此刻的年份、读口、自己的表和影响口……),交回的对象是回话(这里换掉交给 `city.capacity` 的那一栏)。`act` 要当场交回,不能是 `async`。

**4. 写 `README.md` 和 `LICENSE`**,同工具插件。

**5. 打包、试跑。** 需要这个仓库的代码和 Node 22 以上:

```bash
pnpm install
npx tsx scripts/pack-plugin.ts path/to/my-harbor              # 写出 path/to/my-harbor/harbor.civplugin
npx tsx scripts/sim-plugin-try.ts path/to/my-harbor           # 种子 7 推 3000 年,和官方的比一比
npx tsx scripts/sim-plugin-try.ts path/to/my-harbor seed=2024 years=1000 bonus=0.8
```

试跑和网站用的是同一份 QuickJS 和同一套检查:打印插件出手几次、下了哪些命令、被挡下几条、编年史、图层,和几样统计(国家数、战争、灭国、分裂、改朝换代、瘟疫,官方 → 带插件)。插件出错停下的,打印那句错。

编辑器提示:在这个仓库里打开 `examples/plugins/` 下的文件,编辑器照 [`civ-atlas-sim.d.ts`](../../examples/plugins/civ-atlas-sim.d.ts) 给出 `turn`、回话的补全和类型检查。在别处写插件,把这个文件拷过去(它不依赖别的文件),照 [`civ-atlas.d.ts`](../../examples/plugins/civ-atlas.d.ts) 的写法声明全局的 `civAtlas`,类型写 `CivAtlasSim`。

## 什么时候出手

推演按时间往前推。到了某一刻,官方这一刻的事(打仗、立国、每隔几年算的人口和发展……)都办完了,才轮到插件;装了几个插件就按装的先后各出手一次。插件出手的时刻:

- **第 0 年开头**:一定出手一次(`turn.tick` 是 `true`)
- **每隔 `every` 年**:清单 `sim.every`,从 0.5、1、5、10、20、100、1000 年里挑,从第 0 年起每到它的整数倍出手(`turn.tick` 是 `true`)。不写就只有第 0 年和自己约的事
- **自己约的事到了**:见[约事](#约事和随机数)(`turn.events` 里有,`turn.tick` 可能是 `false`)

另外几件事都在这一刻插件出手之前办好:自己的表算到此刻、接官方表的输入表填好此刻的值;`turn.heard` 是上次出手以后官方记下的史事。

插件交的数和命令什么时候起作用:

- **影响口**:交了就一直按交的算,直到下次交新的。官方各自的决策点(每 20 年定城的人口上限、每年看要不要宣战……)不等插件,到时候查影响口里交好的数
- **命令**:从此刻的下一格(1/256 年以后)起生效,和作者下的干预一样办
- **表**:换掉的值从此刻起算

一段推演(新建世界、接着推、地形大事以后往回推的那一段)开一个新的 QuickJS 环境,插件代码从头跑一遍。所以**别用全局变量记东西**:跨回合要记的放进[小本子](#小本子simstate1),不然「存下再接着推」和「一口气推完」会对不上。

## 一回合和回话

`act(turn)` 拿到的一回合(类型在 [`civ-atlas-sim.d.ts`](../../examples/plugins/civ-atlas-sim.d.ts)):

```ts
export interface PluginTurn<V> {
  /** 此刻(这一刻官方的都办完了) */
  readonly year: number;
  /** 照频率该出手的一刻(第 0 年那一次也算) */
  readonly tick: boolean;
  /** 这一刻到了的、自己约的事(按约的先后) */
  readonly events: readonly PluginEvent[];
  /** 上次出手以后官方记下的、listen 里那几种史事(按发生先后,第 0 年那一次是第 0 年的) */
  readonly heard: readonly PluginAnnal[];
  /** 小本子(复制的一份;要改就在回话里交回整本) */
  readonly note: PluginNote | undefined;
  /** 上一回合下的命令里没办的(按回话里的先后;都办了 = 不给) */
  readonly refused?: readonly PluginRefused[];
  /** 读口 */
  readonly read: V;
  /** 自己的表此刻的值(复制的一份,格 × 栏) */
  table(id: string): Float64Array;
  /** 自己交给影响口 id 的那栏此刻的值(复制的一份,格 × 栏;还没交 = 全是不影响的数) */
  influence(id: string): Float64Array;
  /** 自己的随机数:[0, 1),按键直接算,和先后无关(键当整数用) */
  rand(a: number, b?: number, c?: number, d?: number): number;
}
```

回话(什么都不交 = 什么都不改,可以 `return;`):

```ts
export interface PluginReply {
  /** 换上的小本子 */
  note?: PluginNote;
  /** 约以后的事(时刻要比此刻晚) */
  at?: readonly { year: number; kind: number; data?: readonly number[] }[];
  /** 换掉自己几张表的值(格 × 栏,个数要对;压回上下限) */
  tables?: Readonly<Record<string, ArrayLike<number>>>;
  /** 换掉交给影响口的几栏(口名 → 格 × 栏,个数要对;压回口的上下限) */
  influences?: Readonly<Record<string, ArrayLike<number>>>;
  /** 下命令(SimCommand 的写法):此刻的下一格生效 */
  commands?: readonly unknown[];
  /** 写进编年史的几句(记在此刻) */
  chronicle?: readonly PluginChronicle[];
}
```

- 回话里只能有数、字、真假、数组、普通对象和数的类型化数组(`Float64Array` 这类);交回函数、`Promise`、别的类的对象算出错。认不得的键也算出错
- 拿到的都是复制的一份:改 `turn.table(…)`、`turn.influence(…)` 交回来的数组不碰推演,要在回话里交回才算
- 「格 × 栏」:按州的一州一格、按国的一国一格(国的编号就是下标,亡了的国也占一格);多栏的(如 `dev.rate` 有 5 栏)第 `i` 格第 `c` 栏在 `[i * 栏数 + c]`

## 读口(`sim.read@1`)

`turn.read` 看此刻的世界。除了 `year`,都是函数,调了才取(从推演那边现取一份、转进 QuickJS);同一回合里同样的调用只取一次。只取用得上的:每回合读全部的国和城,比只读归属慢得多。

| 读口 | 交回 |
|---|---|
| `read.year` | 此刻(年) |
| `read.regions()` | 州:`count` 个数、`area` 面积(平方公里)、`seat` 治所地块、`biome` 主导地貌、`coastal`(1 = 临海)、`habitability` 宜居分、`neighbors`(州 `r` 的邻州是 `list[start[r] .. start[r + 1])`,含海峡、航线) |
| `read.owners(field)` | 此刻各州归属,`field` 是 `'polity'`(国)、`'culture'`(民族)、`'faith'`(信仰);没有 = −1 |
| `read.polities()` | 所有国家(亡了的也在,`ended` 是亡国那年):国都、民族、从哪国分出来、几州、国力、国库、正在和谁打仗、盟国、宗主、国教、政体、议政…… |
| `read.settlements()` | 所有城(毁了的也在):在哪一州、人口(千人)、等级、是不是港口 |
| `read.cultures()` | 所有民族:种类、发源的州、生于哪年、从哪族分出来 |
| `read.faiths()` | 到此刻有过的信仰:民间信仰 / 大教 / 教派,教派从哪个大教分出来,大教的圣城 |
| `read.official(name)` | 官方表此刻的值,一州或一国一个数,`name` 见[接官方表](#接官方表) |
| `read.annals(from, to?)` | `[from, to]` 年里的史事(按发生先后) |

各字段的意思写在 [`civ-atlas-sim.d.ts`](../../examples/plugins/civ-atlas-sim.d.ts) 的 `SimRead` 那几个类型上;和工具插件读历史的接口同名的字段,意思也一样。

**编号只在这一次推演里有效。** 国、城、民族、信仰的编号就是这些列表的下标,同一次推演里一直指同一个(国亡了也还在列表里);州的编号在地形大事以后会变。拿此刻的编号下命令、写编年史都行;换一个世界、改了历史就不一定指同一个了。命令里也认稳定键(见[命令](#命令simcommands1和-turnrefused))。

## 小本子(`sim.state@1`)

跨回合要记的东西放进小本子:回话里交 `note`,下一回合在 `turn.note` 拿到(复制的一份)。小本子存进世界,接着推时原样接上。

- 只能放**有限的数**、数组、普通对象,一层层套(最多 8 层,约 64 KB:一个数算 8 字节,对象的键一个字算 2 字节)。字、真假、`null`、类型化数组都放不进去:编号、年份、几成都是数,要记「是或不是」就记 1 和 0
- 交回的是整本,不交就照旧;要清空交 `{}` 或 `0`

## 约事和随机数

**约事**:回话里的 `at` 约以后的某一刻再出手一次,带一个种类 `kind`(0–65535 的整数,自己定意思)和最多 16 个数 `data`。到了那一刻 `turn.events` 里有它,不管那一刻是不是照频率该出手。约的时刻要比此刻晚,同时约着的最多 4096 件;年份不必是整数(推演按 1/256 年对齐)。约事要 `sim.events@1`。

**随机数**:要随机就用 `turn.rand(a, b?, c?, d?)`,交回 [0, 1)。它由文明种子、插件编号和你给的几个键直接算出来,和调用先后无关:同样的键永远同一个数,不同的事给不同的键(比如州号、年份、第几种事)。键当整数用,小数部分不算,半年出手一次的插件拿年份当键要先 `Math.round`。QuickJS 里的 `Math.random` 用了就报错。

下面是「彗星」:每隔 150–400 年出现一次,天下动荡 10 年。不写 `every`,只在第 0 年和自己约的时刻出手:

```json
{
  "id": "comet",
  "name": "彗星",
  "version": "1.0.0",
  "role": "sim",
  "api": 1,
  "runtime": "quickjs",
  "requires": ["sim.events@1", "sim.influence@1", "sim.chronicle@1"],
  "sim": { "influences": ["unrest.add"] },
  "description": "每隔几百年出现一次彗星，天下动荡十年。",
  "license": "MIT"
}
```

```js
const COMET = 1;
const GONE = 2;
/** 第 n 颗彗星什么时候来:150–400 年以后 */
const next = (turn, n) => Math.floor(turn.year) + 150 + Math.floor(250 * turn.rand(n));

civAtlas.sim({
  act(turn) {
    const reply = { at: [], chronicle: [] };
    if (turn.year === 0) reply.at.push({ year: next(turn, 0), kind: COMET, data: [0] });
    for (const e of turn.events) {
      const unrest = turn.influence('unrest.add');
      if (e.kind === COMET) {
        const n = e.data[0];
        unrest.fill(0.2);
        reply.chronicle.push({ text: '彗星见于天,人心惶惶' });
        reply.at.push({ year: turn.year + 10, kind: GONE }, { year: next(turn, n + 1), kind: COMET, data: [n + 1] });
      } else {
        unrest.fill(0);
      }
      reply.influences = { 'unrest.add': unrest };
    }
    return reply;
  },
});
```

## 听史事、写编年史

**听史事**(`sim.read@1`):清单 `sim.listen` 写要听哪几种史事(`war` 宣战、`fall` 亡国、`split` 分裂、`plague` 瘟疫……,种类见 [`civ-atlas-sim.d.ts`](../../examples/plugins/civ-atlas-sim.d.ts) 的 `AnnalKind`,各列的意思见 [`src/gen/civ/annals.ts`](../../src/gen/civ/annals.ts))。每次出手,`turn.heard` 是上次出手以后官方记下的这几种,按发生先后;`a`、`b` 按种类是国、民族或城的编号,`region`、`settlement`、`war` 没有是 −1。最多听 64 种。

**写编年史**(`sim.chronicle@1`):回话里的 `chronicle` 是几句话,记在此刻。一句是 `{ text, refs }`:`text` 里用 `{国:a}`、`{州:r}`、`{城:s}`、`{族:c}` 指代,`refs` 给每个指代此刻的编号。存下的是编号,显示时换成名字,所以作者改了国名,编年史跟着变。一句最多 80 个字(不算占位符)、8 个占位符;一个插件在一个世界里最多写 2000 句。

下面是「亡国录」:每亡 50 国,编年史记一句:

```json
{
  "id": "fallen",
  "name": "亡国录",
  "version": "1.0.0",
  "role": "sim",
  "api": 1,
  "runtime": "quickjs",
  "requires": ["sim.read@1", "sim.events@1", "sim.state@1", "sim.chronicle@1"],
  "sim": { "every": 10, "listen": ["fall"] },
  "description": "每亡五十国，编年史记一句。",
  "license": "MIT"
}
```

```js
civAtlas.sim({
  act(turn) {
    let n = typeof turn.note === 'number' ? turn.note : 0;
    const chronicle = [];
    for (const e of turn.heard) {
      n++;
      if (n % 50 === 0) chronicle.push({ text: `{国:a}亡,自开辟以来亡国已${n}`, refs: { a: e.a } });
    }
    return { note: n, chronicle };
  },
});
```

## 自己的表(`sim.tables@1`)

推演插件可以加自己的数:每州、每国或全世界一个(或几个)数,写在清单 `sim.tables` 里,怎么涨落写成公式,由推演和官方的表一起算。插件代码里 `turn.table(id)` 读此刻的值;要整张换掉,回话里交 `tables`。

示例「魔力」的那张表(摘自 [`examples/plugins/magic/plugin.json`](../../examples/plugins/magic/plugin.json)):

```json
{
  "id": "magic",
  "name": "魔力",
  "unit": "region",
  "every": 5,
  "min": 0,
  "max": 100,
  "off": 0,
  "init": 0,
  "consts": { "spread": 0.05, "seep": 0.02, "fade": 0.002, "drain": 0.01, "crowd": 100 },
  "rate": "spread * (nbmean(nb.magic) - magic) + max(seep * (vein - magic), 0) - fade * magic - drain * magic * min(rural / crowd, 1)"
}
```

每年魔力往邻州的平均值靠 5%(漫开),低于灵脉的从灵脉补(`vein` 是另一张表,开头随机定哪些州有灵脉),自己散掉一点,人多的州(`rural` 接官方的乡村人口)耗得快。

表的登记卡:

| 字段 | 必须 | 意思 |
|---|---|---|
| `id` | 是 | 公式里用的名字:字母、汉字、数字、下划线,不以数字开头;不能叫「国」 |
| `name` | 是 | 给人看的名字,最长 40 个字 |
| `unit` | 是 | 按什么记:`region` 一州一个、`polity` 一国一个、`world` 全世界一个(推演插件不能按地块记) |
| `min`、`max` | 是 | 上下限,超出的压回来 |
| `off` | 是 | 没有值时等于什么(地形大事以后新出来的州、不归任何国的州读按国的表) |
| `init` | | 开头的值:一个数,或一条公式(只能读输入表、常数和 `rand()`);不写 = `off` |
| `rate` | | 每年变多少(推演乘上这一步的年数加到旧值上,改频率不用改公式) |
| `rule` | | 新值(要自己乘 `dt`) |
| `move` | | 每年往每个邻州搬走多少(总量不变) |
| `every` | | 多少年算一次(0.5、1、5、10、20、100、1000);不写 = 1 |
| `consts` | | 公式里用的常数:一个数,或按栏取的一串数 |
| `cols` | | 多栏表的栏名(一样东西有好几种,每种一栏) |
| `input` | | `true` = 输入表:没有公式,由推演填(见下面「接官方表」) |
| `kind` | | `"id"` = 编号表:只比是不是同一个 |
| `maxRate`、`after`、`reads`、`zeroStays`、`flowEvery` | | 每年最多变多少、排在哪几张表之后算、只许读哪几张表、全 0 跳过、搬家记成流向 |

`rule`、`rate`、`move` 至少写一样(输入表、编号表不写)。一个插件最多 16 张表、所有表加起来 64 栏。

**公式**写法像表格公式,一条公式算一格(一州、一国)的值:

- 数:`1`、`0.5`、`1e-3`;运算 `+ - * / %(取余) ^(乘方)`,比较 `< <= > >= == !=`,`and`、`or`、`not`
- 名字:一张表(这一格的值;按国的表在州的公式里读这州所属的国)、一个常数、`dt`(这一步过了几年,第一步是 0)、`year`(此刻)、`col`(多栏表正在算第几栏)。所有表读到的都是这一步开头的值,先后不影响结果
- 函数:`if(条件, 是, 否)`、`min`、`max`、`clamp(x, 下, 上)`、`abs`、`floor`、`ceil`、`round`、`sqrt`、`exp`、`log`、`pow`
- 邻州:`nbsum(式子)`、`nbmean`、`nbmax`、`nbmin`、`nbcount(条件)`,式子里 `nb.表名` 是邻州的值(没有邻州 = 0)
- 往下汇总:按国、全世界记的表用 `sumof(式子)`、`meanof`、`maxof`、`minof`、`countof(条件)` 汇总底下更细的那些格(国里的各州……)
- 随机:`rand()` 或 `rand(0–4095 的整数)`,由种子、这张表、这一格、这一年、这一栏定
- `let 名字 = 式子` 起中间量,最后一行是结果;`#` 或 `//` 到行尾是注释。在 JSON 里换行写成 `\n`

公式只能读表、做算术、得出一个数,没有循环、碰不到别的东西。写错了打包时就会说哪里不对(哪张表的哪条公式、错在哪)。算着算着出了不是数的值、大批格子一步涨一步跌(来回震荡),推演停下、报是哪张表。

### 接官方表

`sim.inputs` 把自己的一张输入表接到官方的一张表上:`{ "rural": "rural" }` = 自己的表 `rural`(卡上写 `"input": true`、只有一栏、单位和官方表一样)每一刻填官方乡村人口此刻的值。能接的官方表(插件代码里 `turn.read.official(name)` 也读得到):

| 名字 | 单位 | 意思 |
|---|---|---|
| `rural` | 州 | 乡村人口(千人) |
| `control` | 州 | 中央管得到几成(0–1) |
| `unrest` | 国 | 动荡 |
| `dev.production`、`dev.transport`、`dev.information`、`dev.administration`、`dev.mobilization` | 州 | 发展度:生产、运输、信息、行政、动员 |
| `res.grain`、`res.livestock`、`res.copper`、`res.iron`、`res.coal`、`res.timber`、`res.salt`、`res.fish`、`res.oil`、`res.rare`、`res.gold` | 州 | 物产眼下能用多少(0–3 档):粮、牲畜、铜锡、铁、煤、木材、盐、渔获、石油、稀有矿、金银 |
| `ideology.mandate`、`ideology.law`、`ideology.council`、`ideology.craft`、`ideology.rights`、`ideology.nation`、`ideology.commons` | 州 | 各说的接受度(0–1):天命、律法、共治、技艺、民权、国族、均产 |

## 图层

按州记数的表可以标成图层(清单 `sim.layers`,要 `sim.tables@1`):推演每隔 `keep` 年存一份那张表的值,从第 0 年起,存进世界。看世界的人没装插件也看得到,能按年份看它怎么变。存下的格式和网站怎么画见[存进世界的图层](layer-format.md)。

```json
{
  "id": "magic",
  "table": "magic",
  "title": "魔力浓度",
  "ramp": { "colors": ["#1b1036", "#5b2a9e", "#a46cff", "#f2e6ff"], "min": 0, "max": 60 },
  "legend": "魔力（0–100）",
  "keep": 50
}
```

- `id`:图层编号,小写字母、数字、连字符,最长 25 个字
- `table`:哪张表,要按州记、记数;多栏的表再给 `col` 栏名
- `keep`:每隔几年存一份,1–1000 的整数
- 样子和工具插件的地块图层同一套写法:`title`(最长 40 个字),`ramp`(渐变,2–16 色,`min`、`max` 不写按数据定)和 `classes`(分类,1–32 类,`{ value, color, label }`)给且只给一个,可选 `legend`、`opacity`
- 一个插件最多 4 个图层;一个图层存的数最多约 6 MB(份数 × 州数 × 4 字节),超了推演停下,把 `keep` 调大

## 影响口(`sim.influence@1`)

影响口是官方在几个决策点上留的口子:插件交数,官方在那里乘上或加上。清单 `sim.influences` 写要交哪几个口,`turn.influence(id)` 拿到自己交给它的那一栏(还没交 = 全是不影响的数:乘的是 1,加的是 0),改好在回话 `influences` 里交回。交的数压回口的上下限;几个插件交同一个口,乘的乘在一起,加的加在一起。

| 口 | 按 | 乘 / 加 | 上下限 | 作用在哪 |
|---|---|---|---|---|
| `city.capacity` | 州 | 乘 | 0.25–4 | 城的人口上限(每 20 年定一次、建城时记起) |
| `rural.capacity` | 州 | 乘 | 0.25–4 | 乡村人口的上限 |
| `unrest.add` | 州 | 加 | −0.5–0.5 | 动荡:各州的数按本国的州平均,加进本国的动荡 |
| `dev.rate` | 州,5 栏 | 乘 | 0–4 | 发展度五种能力(生产、运输、信息、行政、动员)长得多快 |
| `assim.rate` | 州 | 乘 | 0–4 | 同化的快慢 |
| `control.reach` | 国 | 乘 | 0.25–4 | 中央管得到的远近 |
| `war.odds` | 国 | 乘 | 0–4 | 看邻国时宣战的几率(挑好了打谁以后) |
| `war.power` | 国 | 乘 | 0.25–4 | 国力(打仗、邦交、立约比的国力) |
| `split.odds` | 国 | 乘 | 0–4 | 起兵自立(分裂)的几率 |
| `dynasty.odds` | 国 | 乘 | 0–4 | 改朝换代的几率 |
| `plague.odds` | 州 | 乘 | 0–4 | 自己起瘟疫的几率 |
| `plague.loss` | 州 | 乘 | 0.25–4 | 自己起的瘟疫里城死几成 |

按国交的数,出手以后才立的国(编号超出交的格数)按不影响算;下次出手 `turn.influence` 交回的格数就跟上了。两国之间的宣战、结盟没有影响口:要指名两国就下命令。

## 命令(`sim.commands@1`)和 `turn.refused`

回话里的 `commands` 是几条命令,写法和作者在网站上下的干预一样,从此刻的下一格起生效。清单 `sim.commands` 要写会下哪几种,下了没写的算出错;网站装插件时把这几种列给用的人看。

| `kind` | 写法 | 意思 |
|---|---|---|
| `declare` | `a`、`b` | `a` 向 `b` 宣战(两国不接壤、已在交战、有一方已亡 = 打不成,编年史照记) |
| `ally` | `a`、`b`,可选 `until` | 两国结盟到 `until` 年(不给 = 一直) |
| `treaty` | `a`、`ps`(另 1–3 国),可选 `term`、`limited`、`keep`、`by`、`zone`、`ask` | 几国立约互不侵犯 `term` 年;`ask: true` = 对方照推演的规矩定肯不肯 |
| `cede` | `a`、`region`,可选 `permanent` | 这州划给 `a` |
| `found` | `region`,可选 `name` | 以这州的城为国都立一个新国 |
| `move` | `a`、`city` | `a` 迁都到这座城 |
| `destroy` | `a`,可选 `b` | `a` 亡,国土并入 `b`(不给 = 散成无主) |
| `disaster` | `type: 'plague'` + `city`,`'famine'` + `a` 或 `regions`,`'quake'` + `region`;`level` 1–3 | 瘟疫、饥荒、地震水旱 |
| `trek` | `folk`,可选 `region`、`to`、`reach`、`dir` | 这一族分出一支举族远走 |

国、州、城、民族写此刻读口里的编号,或稳定键(`polity:c4567#0` 这类,和工具插件、作者的干预同一套)。写法不对(编号不在、字段不认得)算出错。一次最多 64 条,一个世界里推演插件一共最多下 10000 条。

**作者的干预优先。** 用的人在网站上下的「不许灭」「禁止分裂」「不许扩张」「结盟」「不许迁」挡得住插件的命令:挡下的不办、不记、不算出错,下一回合在 `turn.refused` 里告诉插件,一条一个 `{ kind, index, why }`(`index` 是上一份回话 `commands` 里的第几条,`why` 是挡它的干预):

| `why` | 作者的干预 | 挡下 |
|---|---|---|
| `protect` | 不许灭 | 灭这国、划走它最后一个有城的州、在那里立国 |
| `unity` | 禁止分裂 | 在这国的州里立国 |
| `halt` | 不许扩张 | 这国宣战 |
| `ally` | 结盟 | 结盟的两国之间宣战 |
| `stay` | 不许迁 | 这一族的大迁徙 |

下面是「征伐」:每 100 年,天下最强的国向它最强的邻国宣战;被挡下就在编年史记一句:

```json
{
  "id": "conquest",
  "name": "征伐",
  "version": "1.0.0",
  "role": "sim",
  "api": 1,
  "runtime": "quickjs",
  "requires": ["sim.read@1", "sim.events@1", "sim.state@1", "sim.commands@1", "sim.chronicle@1"],
  "sim": { "every": 100, "commands": ["declare"] },
  "description": "每百年，天下最强的国讨伐它最强的邻国。",
  "license": "MIT"
}
```

```js
const WHY = { halt: '不许扩张之令', ally: '盟约' };

civAtlas.sim({
  act(turn) {
    const chronicle = [];
    const last = /** @type {number[] | undefined} */ (turn.note);
    for (const x of turn.refused ?? []) {
      if (last) chronicle.push({ text: `{国:a}欲伐{国:b},为${WHY[x.why] ?? x.why}所阻`, refs: { a: last[0], b: last[1] } });
    }
    const ps = turn.read.polities();
    const owner = turn.read.owners('polity');
    const { start, list } = turn.read.regions().neighbors;
    let a = -1;
    for (const p of ps) if (p.ended === undefined && p.size > 0 && (a < 0 || p.power > ps[a].power)) a = p.id;
    let b = -1;
    for (let r = 0; a >= 0 && r < owner.length; r++) {
      if (owner[r] !== a) continue;
      for (let e = start[r]; e < start[r + 1]; e++) {
        const q = owner[list[e]];
        if (q >= 0 && q !== a && !ps[a].wars.includes(q) && (b < 0 || ps[q].power > ps[b].power)) b = q;
      }
    }
    if (b < 0) return { chronicle };
    return { note: [a, b], commands: [{ kind: 'declare', a, b }], chronicle };
  },
});
```

## 滑条

清单 `sim.params` 给新建世界时拨的滑条,插件里读 `civAtlas.params.<名字>`(只读)。最多 8 个,名字用字母、数字、下划线(不以数字开头,最长 32 个字),每个写 `label`(最长 12 个字)、`min`、`max`、`default`,可选 `step`。拨到几记进世界:接着推要用同样的数,改了滑条就和换了插件一样,从第 0 年重推。

## 能力和权限框

推演插件能要的能力(都只给推演插件,工具插件要不了):

| 能力 | 能用的 | 权限框上那一行 |
|---|---|---|
| `sim.read@1` | `turn.read`、`turn.heard`、清单 `listen` | 在推演里加自己的数和事件、写编年史 |
| `sim.tables@1` | 清单 `tables`、`inputs`、`layers`,`turn.table`,回话 `tables` | 同上一行 |
| `sim.events@1` | 清单 `every`,`turn.events`,回话 `at` | 同上一行 |
| `sim.chronicle@1` | 回话 `chronicle` | 同上一行 |
| `sim.state@1` | `turn.note`,回话 `note` | 同上一行 |
| `sim.influence@1` | 清单 `influences`,`turn.influence`,回话 `influences` | **会改推演怎么走(只影响用它新推的世界,已经推好的世界不变)**,显眼 |
| `sim.commands@1` | 清单 `commands`,回话 `commands`,`turn.refused` | 同上一行 |

只读、只加自己的数的插件权限框上一行;交影响口、下命令的多一行显眼的。网站另外用自己的话列出它会下哪几种命令、会影响哪几处(照清单 `commands`、`influences`),作者在 `why` 里写的理由跟在那一行下面。推演插件的权限框最底下一行是:

> 它不能联网、看不到你的 AI 密钥和账号、看不到别的世界、改不了地形。

清单的 `sim` 段用到哪样就要在 `requires` 里写上哪样(`every` 要 `sim.events@1`,`listen` 要 `sim.read@1`,`tables`、`inputs`、`layers` 要 `sim.tables@1`,`influences` 要 `sim.influence@1`,`commands` 要 `sim.commands@1`),打包时就查;代码里用的(读口、小本子、编年史、约事)也要写全。权限框上的字以网站上显示的为准。

## QuickJS 里没有什么

推演插件跑在 QuickJS 里:只有 JS 语言本身(`Array`、`Map`、`Math`、`JSON`、类型化数组……)和 `civAtlas`。为了同一个种子在哪里推都得到同一段历史、跑的代码和审过的一样,这几样用了就报错:

- `Date`(包括 `Date.now()`):历史不能跟着现实的时间变
- `Math.random()`:要随机数用 [`turn.rand`](#约事和随机数)
- `eval`、`Function` 构造器(包括 `async`、生成器函数的构造器)

这些本来就没有:`fetch` 和一切联网、`setTimeout` 等定时器、`Worker`、`WebAssembly`、`Atomics`、`Intl`、`TextEncoder`、`structuredClone`、`self`、`postMessage`、`importScripts`。用到的库直接写进 `main.js`(普通脚本,不能 `import`)。

`console.log`、`console.warn` 这些可以留在代码里,什么都不做,也不出错。要看中间算出来的数,用 `scripts/sim-plugin-try.ts` 试跑,把要看的写进编年史或小本子。

## 上限

| 项目 | 上限 | 超了 |
|---|---|---|
| 插件文件 | 同工具插件:2 MB;`main.js` 1 MB | 装不上 |
| 一个世界的推演插件 | 4 个 | 推演开不了 |
| 一刻里用时 | 一个插件 2 秒(算表、出手、办回话加起来) | 推演停下 |
| 一段推演里用时 | 所有推演插件加起来 30 秒 | 推演停下(算用得最多的那个) |
| 内存 | 一个插件的 QuickJS 64 MB | 推演停下 |
| 调用套的深度 | QuickJS 的栈 64 KB | 推演停下 |
| 表 | 16 张、一共 64 栏 | 打包时就报 |
| 图层 | 4 个;`keep` 1–1000 年;一个图层约 6 MB | 打包时 / 推演停下 |
| 听史事 | 64 种 | 打包时就报 |
| 小本子 | 约 64 KB,8 层 | 推演停下 |
| 约事 | 同时 4096 件,一件 16 个数 | 推演停下 |
| 命令 | 一次 64 条;一个世界里推演插件一共 10000 条 | 推演停下 |
| 编年史 | 一句 80 个字(不算占位符)、8 个占位符;一个插件在一个世界里 2000 句 | 推演停下 |
| 滑条 | 8 个,`label` 12 个字 | 打包时就报 |

## 出错了会怎样

插件抛出没接住的错、回话写错(键不认得、个数不对、命令写错、下了清单没写的命令)、超时、内存用完,这一次推演停下,报出是哪个插件、第几年、什么错。用试跑脚本看得到同一句话。

已经推好的世界不受影响:推演插件的效果都落在存下的历史里(城的人口、乡村人口、动荡、史事、归属……),看世界不需要插件。

## 写推演插件时照着查

这几条写插件时自己对一遍;作品墙收推演插件以后,审核也看这些:

- 做的和清单、README 里说的一致,`why` 写清交影响口、下命令是为了什么
- 能力没多要:清单里要的,代码里、`sim` 段里都用得到
- **随机数只用 `turn.rand`**,不靠 `Date`、`Math.random`(反正用不了)
- **别用全局变量记东西**:跨回合的放小本子。全局变量只放常数、函数
- 同一个种子、同一套插件和滑条推两遍,历史一模一样;推到一半存下再接着推,和一口气推完一样
- 编年史的字合规,不显示不合适的内容
- 代码是人能读的,不压缩、不混淆
- 种子 7、2024 各推 3000 年推得完(`scripts/sim-plugin-try.ts`),看一眼统计和编年史是不是你想要的
