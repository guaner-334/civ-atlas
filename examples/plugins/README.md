# 示例插件

「文明与地图」插件开发文档([`docs/plugins/`](../../docs/plugins/))里的三个示例,一个文件夹一个,MIT 许可证,拷走改改就能用。

| 文件夹 | 插件 | 做什么 |
|---|---|---|
| [`coast-distance/`](coast-distance/) | 离海多远 | 每块陆地走陆路到海边多少公里,画成一个地块图层(最小的例子) |
| [`route-days/`](route-days/) | 量路程 | 点两个点,按地形算要走几天,画出路线;用到面板、按钮、下拉、可选的能力 |
| [`box-summary/`](box-summary/) | 框选合计 | 框一片,按看的年份合计面积、人口、城市、各国占多少;能存成一个标记(改你写的东西) |

每个文件夹里:`plugin.json`(清单里自己写的几项)、`main.js`、`README.md`、`LICENSE`,和打好的 `<id>.civplugin`。
改了以后重新打包:

```bash
npx tsx scripts/pack-plugin.ts examples/plugins/route-days
```

`tsconfig.json` 和 `civ-atlas.d.ts` 让编辑器认得 `civAtlas`,不进插件包。

这三个示例也是网站的测试:单测核对重新打包和仓库里的 `.civplugin` 一个字节不差、用到的调用清单里都要了;`pnpm test:sandbox` 在三个浏览器的真沙箱里对种子 7、2024 各跑一遍,交出来的面板、图层和 `tests/fixtures/plugin-examples.json` 对上。
