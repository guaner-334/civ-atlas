# 示例插件

「文明与地图」插件开发文档([`docs/plugins/`](../../docs/plugins/))里的示例,一个文件夹一个,MIT 许可证,拷走改改就能用。

工具插件:

| 文件夹 | 插件 | 做什么 |
|---|---|---|
| [`coast-distance/`](coast-distance/) | 离海多远 | 每块陆地走陆路到海边多少公里,画成一个地块图层(最小的例子) |
| [`pop-density/`](pop-density/) | 人口密度 | 每 50 年算一次各国的人口密度,画成跟着时间轴变的按州图层;存进世界以后别人没装也跟着变 |
| [`route-days/`](route-days/) | 量路程 | 点两个点,按地形算要走几天,画出路线;用到面板、按钮、下拉、可选的能力 |
| [`box-summary/`](box-summary/) | 框选合计 | 框一片,按看的年份合计面积、人口、城市、各国占多少;能存成一个标记(改你写的东西) |

推演插件(见[推演插件](../../docs/plugins/sim.md)):

| 文件夹 | 插件 | 做什么 |
|---|---|---|
| [`weariness/`](weariness/) | 厌战 | 有议会的国家开战要先过议会;久攻不下、打得太久的仗,议会遣使议和 |
| [`faith/`](faith/) | 宗教生效 | 异教的州难治、难融合,异教邻国更容易开战;圣城被异教国占了就兴兵去夺,同教的小国联手对付异教强邻 |
| [`magic/`](magic/) | 魔力 | 每州一个魔力浓度,公式写在清单的表里、存成图层;魔力浓的州城的人口上限高 |

地图插件(见[地图插件](../../docs/plugins/map.md)):

| 文件夹 | 插件 | 做什么 |
|---|---|---|
| [`craters/`](craters/) | 环形山 | 砸出几十个陨石坑,坑底下陷、坑沿隆起,陆地上的坑积水成湖;滑条:坑有几个、多大 |
| [`koppen/`](koppen/) | 柯本气候 | 季风让副热带东岸多下雨;再把每块陆地分成柯本的 30 类,画成分类图层 |
| [`tides/`](tides/) | 潮汐 | 按大陆架多宽、海湾多封闭算近岸的潮差,画成渐变图层;不改地图 |

每个文件夹里:`plugin.json`(清单里自己写的几项)、`main.js`、`README.md`、`LICENSE`,和打好的 `<id>.civplugin`。
改了以后重新打包:

```bash
npx tsx scripts/pack-plugin.ts examples/plugins/route-days
```

推演插件可以在这个仓库里试跑(种子 7 推 3000 年,和官方的比一比):

```bash
npx tsx scripts/sim-plugin-try.ts examples/plugins/magic
```

地图插件也能试跑(种子 7 长一张图,和不带插件的比一比;几个插件按出手的先后写):

```bash
npx tsx scripts/map-plugin-try.ts examples/plugins/craters examples/plugins/koppen examples/plugins/tides
```

`tsconfig.json`、`civ-atlas.d.ts`、`civ-atlas-sim.d.ts` 和 `civ-atlas-map.d.ts` 让编辑器认得 `civAtlas`,不进插件包。

这些示例也是网站的测试:单测核对重新打包和仓库里的 `.civplugin` 一个字节不差、许可证是 MIT。工具插件:用到的调用清单里都要了;`pnpm test:sandbox` 在三个浏览器的真沙箱里对种子 7、2024 各跑一遍,交出来的面板、图层和 `tests/fixtures/plugin-examples.json` 对上;有意改了示例,`pnpm test:sandbox --update` 重写这份快照。推演插件:打成插件包关进 QuickJS,对种子 7、2024 各推 3000 年,厌战、宗教生效推出来的历史和照接口直接跑的一模一样,魔力的结果钉在 `tests/sim-plugin-examples.test.ts` 里。地图插件:打成插件包关进 QuickJS,三个一起开,在种子 7、2024 上长出的地图和照接口直接跑的一模一样,再推 3000 年长得出文明;各自的效果和滑条见 `tests/map-plugin-examples.test.ts`。
