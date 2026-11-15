# 插件接口变更记录

网站每次发布动了插件接口,就在这里记一条:哪一版网站,加了、改了、拿掉了什么,写插件的人要不要改、怎么改。新的在上面。

- **稳定接口**只加不改:加了新接口、补上漏的,老插件不用动;意思要变就出新版本(比如 `world.read@2`),旧版至少再留一年,两版都记在这里
- **实验接口**网站更新时可能改意思、改名或拿掉(见[稳定接口和实验接口](limits.md#稳定接口和实验接口)),动了一律单列在「实验接口」那一段,写清用了它的插件要怎么改
- 测试网站上已经有、正式网站还没有的,先记在「还没发布」那一段,发布时换成那一版的版本号
- 实验接口里会让老插件用不了的改动,先在测试网站(https://atlas.gerdor.top/beta/)上放满至少一周,再上正式网站;「还没发布」那一段会写明哪天上正式网站,这一周里可以拿测试网站试着改插件、出新版
- 网站的版本号在侧栏「更多」菜单最底下

## 每一条记什么

照这个样子写,没有的那一段不写:

```
## 网站 X.Y.Z(哪年几月几日发布)

### 加了
- `xxx`(哪种插件、哪样能力):能做什么

### 改了
- `xxx`:以前怎样,现在怎样;老插件要不要改、怎么改

### 拿掉了
- `xxx`:用什么代替

### 实验接口
- `xxx` 加了 / 改了 / 拿掉了:改了什么;用了它的插件要怎么改
```

## 还没发布(测试网站上已经有)

这一批加的接口都是稳定档,没有实验接口。老插件都不用改。

### 加了

- 新能力 `view.control@1`(工具插件):`view.seek({ year })` 翻时间轴、`view.fly({ cells?, box?, polities?, regions?, settlements?, year? })` 把地图移过去、`view.highlight({ polities?, regions?, year? })` 圈出几国几州、`view.unhighlight()` 拿掉。用的人按着地图或时间轴时 `seek`、`fly` 回 `busy`;一秒最多 4 次、2 次、10 次。权限框上多一行「会替你翻年份、移地图」。(#678)
- 新能力 `file.save@1`、`file.open@1`(工具插件):`file.save({ name, content })` 请用的人保存一个文件(最大 2 MB,只收 csv、tsv、txt、json、geojson、png、jpg、jpeg、webp)、`file.open({ accept?, max? })` 请用的人选一个文件(默认最大 16 MB),用的人不存、不给回 `cancelled`。只要了这两样能力的插件也出现在「工具」里。(#683)
- 面板格子 `input`(输入框,多行用 `multiline`)、`color`(挑颜色)、`tabs`(页签,最多 8 页);`table`、`list` 加 `id?`、`to?`,给了 `id` 一行(一项)能点;`text` 可以是一串,里面夹链接 `{ text, id?, to? }`。这些的 `panel.action` 事件:输入框给框里的字,颜色给 `#rrggbb`,能点的表格、列表给第几行,页签给第几页。现在网站只认 `id`,只给 `to` 的点不了。(#682)
- 工具插件读历史(`history.read@1`)多了:`history.dynasties`(各朝)、`history.treaties`(条约)、`history.zones`(中立地)、`history.relations({ year })`(那一年的盟约和宗藩)、`history.trade`(商道)、`history.migrations`(大迁徙)、`history.regionStats({ year, fields })`(那一年每州一个数,一次取几种);`history.people` 每项多了世系和婚姻字段(`parent?`、`adopted?`、`mom?`、`husband?`、`spouses?`、`dynasty?`、`descent?`);改名的 `key` 也认朝代、约、商道。一页最多 2000 项,`regionStats` 一次最多 32 种。(#677)
- 工具插件读地图(`world.read@1`)多了 `world.plates()`(板块),`world.cells` 多了 `plate`、`currentX`、`currentY`、`currentTemp` 这四样;读你写的东西(`author.read@1`)多了 `author.terrain()`(改过的地形)。(#677)
- 推演插件(`sim.read@1`)的读口 `read` 多了:`sacks(from, to?)`(城受的灾)、`wars()`、`truces()`、`grudges()`、`handover()`、`pacts()`、`rulers()`、`trades()`、`treks()`、`plague()`;`read.polities()` 每国多了朝代和政体分段、议事定下的规矩、方针,`read.settlements()` 每城多了建城时的民族、人口上限;听史事的 `turn.heard` 有由头的另带 `cause`,立约、约满、设中立地另带 `ps`。(#680)
- 推演插件读官方表(`read.official`)多了:`ideology.polity.*`(各国各说的接受度)、`strife`、`soil`、`era`、`res.base.*`、`res.stock.*`、`fiscal.land`、`fiscal.craft`、`fiscal.market`、`fiscal.tax`、`fiscal.due`、`fiscal.collected`、`fiscal.treasury`、`fiscal.broke`。(#680)
- 地图插件清单 `map.reads`(不要能力,最多 64 样):按清单多递一批数——`plateVx`、`plateVy`、`plateOmega`、`plateContinental`、`convergence`、`convergentKm`、`divergentKm`、`convergentStrength`、`divergentStrength`、`uplift`、`plateau`、`oceanDepth`、`cellArea`、`worldParams`、`edited`(三口都有),`currentU`、`currentV`、`currentTemp`(改气候、出图层),`downstream`、`fillLevel`、`runoff`、`wetland`、`maxElevation`(出图层)。(#679)
- 地图插件帮手多九个:`d.ridged`、`d.flow`、`d.distance`、`d.components`、`d.slope`、`d.cellAt`、`d.line`、`d.westEast`、`d.biomeOf`。`ridged` 和 `noise` 一样最多叠 8 层。(#679)
- 标注图层(`layer.marks`)每项多了 `from`、`to`(时间轴在这几年里才画)和 `style` 的 `width`(线宽 1–8 像素)、`arrow`(`end` / `both`)、`icon`(`castle`、`harbor`、`camp`、`shrine`、`ruin`、`lighthouse`、`bridge`、`volcano`、`battle`、`flag`、`danger`、`star`、`circle`、`square`、`triangle`、`diamond`),`style.color` 可以写 `#rrggbb`。(#684)
- `author.apply` 多两种改动:`{ kind: 'markEdit', id, mark }` 改标记、`{ kind: 'markRemove', id }` 删标记;世界里所有标记都能改、删,和加一样能撤销。(#684)
- 推演插件的影响口(`sim.influence@1`)又开 14 个,都按国交:`revolt.odds`(民变)、`collapse.odds`(大崩解)、`claim.odds`(宗室争位)、`warlord.odds`(新起割据)、`merge.odds`(小国并入同族大国)、`restore.odds`(复国)、`alliance.odds`(结盟)、`submit.odds`(称臣)、`defect.odds`(藩属自立)、`treaty.odds`(立约)、`marry.odds`(结亲)、`aid.odds`(援盟)乘在几率上,0–4;`war.length`(一场仗最多打几年)、`war.goal`(一场仗想拿下几州)按攻方乘,0.25–4。各自按哪一国、管哪一处,见[影响口](sim.md#影响口siminfluence1)。(#724)
  - 读口 `read.wars()` 里还在打的仗的 `goal`、`length` 把插件交给 `war.goal`、`war.length` 的倍数乘上了(交了 `war.goal` 的,`goal` 可能带小数)
  - 这一版网站存的、带推演插件的世界,在旧版网站上照样打得开、看得了,只是接着推要从第 0 年推起
- 推演插件的影响口又开 8 个按州交的:`sack.odds`(洗劫)、`ruin.odds`(毁城)、`rebuild.odds`(重建)、`plague.spread`(瘟疫传开)、`famine.odds`(饥荒)、`diverge.odds`(民族分化)、`trek.odds`(大迁徙动身,按这一族的发源州)乘在几率上,0–4;`defense.power`(守这一州的兵力)0.25–4。清单 `sim.influences` 最多写的口数 32 → 64。(#726)

### 改了

- 放宽的上限(都是放宽,原来能用的照样能用):(#685)
  - 面板的字 4000 个 → 20000 个
  - 插件自己的设置 `store.local` 64 KB → 1 MB
  - 插件文件 2 MB → 8 MB(`main.js` 1 MB → 7 MB)
  - 一秒发话 200 条 → 500 条
  - 插件代码顶层要跑完的时间 10 秒 → 30 秒
  - 同时没回的调用 16 个 → 64 个
  - 地块图层和按州按年份的图层、标注图层各 4 个 → 8 个;所有标注图层合起来最多 20000 项
  - 存进世界的插件图层:一个世界一共最多 16 个(不分哪个插件),满了用的人点「存进这个世界」时当场说存不下
- 错误码 `busy` 多了几种情形:用的人正按着地图或时间轴、翻年份移地图太快、上一次选文件还没完;`cancelled` 也用在没存文件、不给文件。(#678、#683)
- `author.write@1` 在权限框上写成「会改你写的东西(改国名人名、加改删标记和批注、下命令)」。(#684)

## 网站 1.7.0(2026 年 11 月 15 日发布)

### 改了

- 推演插件读口 `read.polities()` 里每国的 `allies`(盟国):以前只列邦交里自然结成的盟;现在用的人下的「结盟」、推演插件用 `ally` 命令结的盟也列进去(这些推演里本来就算盟国,被宣战时盟国照它援盟)。编号升序、不重复;过了 `until` 不再列;亡了的国没有盟国,也不出现在别国的盟国里。
  - 要不要改:不用改。以前在小本子里自己记着结了谁的,现在可以直接读 `allies`
  - 已经存下的世界照原样。读 `allies` 的推演插件在这一版网站上推,世界里有用的人下的结盟、或别的插件结的盟时会多看到盟国,推出来的历史可能和以前不一样
