# 给 AI 助手:帮人写「文明与地图」的插件

这个文件夹是示例插件,一个文件夹一个,拷走改改就是新插件。

## 先读

| 要写的 | 读 |
|---|---|
| 三种插件各是什么、十分钟写一个、怎么装来试 | [`docs/plugins/README.md`](../../docs/plugins/README.md) |
| 工具插件(`role: "tool"`) | [`api.md`](../../docs/plugins/api.md),类型 [`civ-atlas.d.ts`](civ-atlas.d.ts) |
| 推演插件(`role: "sim"`) | [`sim.md`](../../docs/plugins/sim.md),类型 [`civ-atlas-sim.d.ts`](civ-atlas-sim.d.ts) |
| 地图插件(`role: "map"`) | [`map.md`](../../docs/plugins/map.md),类型 [`civ-atlas-map.d.ts`](civ-atlas-map.d.ts) |
| 清单每个字段 | [`package.md`](../../docs/plugins/package.md) |
| 上限、沙箱挡住的事 | [`limits.md`](../../docs/plugins/limits.md) |

## 写的时候

- 只用文档和类型定义里有的调用、能力、口子、命令,没有的不要编
- 清单 `requires` 只写代码里用得到的能力
- 推演、地图插件:随机数只用 `turn.rand` / `d.rand`;跨回合要记的放小本子,不放全局变量
- 写完打包(打包时照网站的规矩核对一遍),再试跑:

  ```bash
  npx tsx scripts/pack-plugin.ts <插件文件夹>
  npx tsx scripts/sim-plugin-try.ts <推演插件文件夹>
  npx tsx scripts/map-plugin-try.ts <地图插件文件夹>
  ```

## 接口不够时

想做的事接口里没有:停下来告诉用的人缺的是哪一样,不要编不存在的调用、不要拿别的数据凑、不要绕沙箱。把做得到的部分做完,再照 [`docs/plugins/requests.md`](../../docs/plugins/requests.md) 起草一条接口需求,给用的人看过再提。完整的规矩在那一页的「给 AI 助手」。
