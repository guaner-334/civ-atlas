/**
 * 用户的修改(阶段 4「干预与编辑」):不改种子,记成"在基础世界上的修改",每次生成完再套上去。
 * 改名(本文件的 applyNames)、干预(civ/interventions.ts)、存档 / 读档(savefile.ts)都用这里的格式。纯计算,不碰 DOM。
 *
 * ## 稳定键
 *
 * 干预会改写历史:干预年份之后,国家、城镇的编号(数组下标)可能变;改地形会重新生成世界,州也重新划分、重新编号。
 * 所以修改里引用实体一律用"稳定键" —— 按**地块**(网格只由种子决定,改地形也不变,是天然的位置锚)定位,
 * 历史改写、改地形以后尽量指回同一个地方。键是人能看懂的字符串:
 *
 * | 键                          | 指的是                                                                      |
 * |-----------------------------|-----------------------------------------------------------------------------|
 * | `polity:c4567#0`            | 国家:立国时国都所在的州(4567 = 那座城的地块,也就是这州的治所地块),这州第 0 个立国的(按立国先后) |
 * | `settlement:c4567#1`        | 城:地块 4567 所在的州里第 1 座城(按建城先后;0 = 最早的,毁了又在故址重建的 +1)   |
 * | `place:mountains@c4567#0`   | 地理实体:种类(sea / mountains / river / lake / island / desert)+ 锚点地块 4567;同种类同锚点的第 0 个(几乎总是 0) |
 * | `culture:c4567#0`           | 民族:发源在地块 4567 所在的州(4567 = 发源州的治所地块),这州第 0 个发源的(几乎总是 0) |
 * | `faith:c4567#0`             | 信仰:大教 = 圣城所在的州,教派 = 分出时那国国都所在的州,民间信仰 = 那个民族的发源州;这州第 0 个(按创立先后,民间信仰在前) |
 * | `dynasty:c4567#0/2`         | 朝代:国家 `polity:c4567#0` 的第 2 朝(Polity.dynasties 的下标,0 = 立国时那一朝)  |
 * | `region:c4567`              | 州:包含地块 4567 的那一州(4567 = 这州的治所地块)                              |
 *
 * 解析(resolveKey):先找"现在包含这个地块的州",再在这州里按"第几个"找国家 / 城 / 民族。同一个世界里和按州号找完全一样;
 * 改地形以后州重新划分,键跟着地块走 —— 指到"同一块地方"现在的那一州、那里立的国、建的城;那块地方变成了水、
 * 或者新历史里那里没有第几个国家 / 城,就是找不到(改名忽略,干预不生效,界面上标"暂未生效")。
 *
 * **旧键**(`polity:r123#0`、`settlement:r123#1`、`culture:r45#0`、`dynasty:r123#0/2`、`region:r123`,r 后面是州号;
 * GENERATOR_VERSION 2 以前写的存档、分享链接里都是这种):照样能读,按原来的方式(州号)解析。新写入的一律是 c 格式。
 * 读档、打开分享链接、自动恢复时,界面先用 upgradeLegacyKeys 把旧键就地换成 c 格式(州号 → 那一州的治所地块;
 * 按读档那一刻生成的世界解析,自动存跟着写回去)。州只由地形定、和历史无关;GENERATOR_VERSION 3 改了小湖的位置,
 * 大多数州的划分不受影响,附近有小湖挪了的那几州可能错开 —— 升级以后就按地块定位了,以后不会再错开。
 * 没有锚点地块的地理实体(旧数据)用 `place:{种类}@i{places 下标}`。
 * 东方国家第一朝的国号就是国名词根:改它用 polityKey(`dynasty:…/0` 也认,同时给了以 polityKey 为准)。
 *
 * ## 改名
 *
 * WorldEdits.names:稳定键 → 新名字。国家改的是国名词根(全称 = 词根 + 当年的国号,见 gen/civ/growth.ts),
 * 东方的朝代改的是那一朝的国号词根,西幻的朝代改的是王室名(显示为"某某王朝");城、地名、民族直接改(民族不带"族"字)。
 * 人物(君主、将领、名臣、宗室,键见 personKey)改的是本名,称号(庙号、谥号、几世)照旧;生成时的名字留在 Person.defaultName。
 * 州名写进新 Civ 的 regionNames(civ.regions 保持同一份:画国土、国界的缓存都按它存,改州名不重画底图)。
 * applyNames 返回套上名字的新 Civ(原 Civ 不改;没有任何名字生效时直接返回原 Civ)。连带跟着变的(用户没单独改过的):
 * - 复国的国家("后昌")跟着故国的国号变("昌" 改成 "秦" → "后秦")
 * - 同族在故址上重建、沿用旧名的城,跟着旧城的名字变
 *
 * WorldEdits.aiNames(可选):哪些名字是从 AI 起名里挑的。稳定键 → { name: 挑的那个名字, was: 挑之前的名字(没改过 = 不写) }。
 * 只是记一笔来源:names 里这个键还是这个名字 = "AI 写"(之后自己再改、恢复默认、撤销都不算了);
 * 导出时选"换回原名"就用 was(没有 = 生成时的名字)。不影响生成和推演。
 *
 * ## 改旗
 *
 * WorldEdits.flags(可选):作者改过的国旗。稳定键 → 一面旗的写法(civ/flags.ts 的 encodeFlag,如 `"b/plain/W/e=R/k=long"`)。
 * 键是国家(`polity:c4567#0`,改的是第一朝)或朝代(`dynasty:c4567#0/2`,改的是第 2 朝);改的是"这一国从这一朝起"的旗,
 * 之后换朝代照它往下配(见 civ/flags.ts)。旗是推演结束后贴上去的,不影响生成和推演。没有这一项 = 全部自动配。
 *
 * ## 干预
 *
 * WorldEdits.interventions:作者在某一年给历史下的"命令"。改名只是换字,干预会改写历史 —— 带着干预从第 0 年整段重推
 * (gen/civ/interventions.ts 执行):**干预年份之前的历史和不干预时逐字节一致**,之后按新规则展开。
 * 国家、州、城一律用稳定键(`polity:c4567#0`、`region:c890`、`settlement:c890#1`),推演到要用的时候才解析成当时的编号;
 * 国家键指不到(新历史里这个国家没出现、或者到那一年还没立国)= 这条干预不生效,不报错。
 *
 * | kind      | 意思     | 字段                              | from(整数年份)                          | 可选                          |
 * |-----------|----------|-----------------------------------|-------------------------------------------|-------------------------------|
 * | `protect` | 不许灭   | a = 国家                          | 从这一年起:国都攻不下、不会被并掉(国土照样会丢、会分裂、会改朝换代) | until:到这一年止(不含;不给 = 一直) |
 * | `ally`    | 结盟     | a = 国家,b = 另一国               | 从这一年起两国不互相宣战(那一刻正在交战的当即议和);一方被第三国攻打,另一方多半参战 | until:到这一年止(不含;不给 = 一直) |
 * | `declare` | 宣战     | a = 攻方,b = 守方                 | 这一年年初强制开战(两国不接壤 / 已在交战 / 有一方已亡 = 打不成,编年史照记一条) | —   |
 * | `unity`   | 禁止分裂 | a = 国家                          | 从这一年起不会有州叛离(分裂、遗民复国都不会从它的国土里起事) | —                     |
 * | `cede`    | 划州     | a = 得到它的国家,region = 州      | 这一年年初这州归 a(州里有人住才行;原主国照常,不算战争;划走的是原主的国都就迁都,原主只剩这一州就亡) | permanent: true = 永久:之后战争、分裂、复国、合并、议和割地都拿不走它(只要还在 a 手里) |
 * | `found`   | 立国     | region = 州                       | 这一年年初以这州的城为国都立一个新国家(州里没城就先建城;民族 = 当地民族;州原来有主的,算从原主分出来) | name:国名(国名词根,同改名) |
 * | `move`    | 迁都     | a = 国家,city = 城                | 这一年年初迁都到这座城(城要在 a 的国土里、没被毁) | —                            |
 * | `halt`    | 不许扩张 | a = 国家                          | 从这一年起不进无主的州、不主动宣战、不援盟、不并小国;那一刻它挑起的战争当即议和。被打时照常防守、反攻夺回自己的州 | until:到这一年止(不含;不给 = 一直) |
 *
 * 立国出来的新国家也有稳定键:`polity:c{州的治所地块}#{n}`(n = 新历史里这州之前立过几国;干预年份之前的历史不变,所以 n 是定的),
 * 和别的国家一样能改名、能被别的干预引用。
 * 年份语义:from 那一年的年初(第 from 年的第一刻)生效,同一刻里先于别的一切事件;干预在列表里的先后 = 同一年里的先后。
 * 列表里的先后也是史事 intervene 的 war 列(下标)。读进来的列表先过 cleanInterventions(种类不认识、键的格式不对的丢掉)。
 *
 * ## 地形修改
 *
 * WorldEdits.terrain:作者动手改的地形("这里放一座火山"),按先后排。和干预不同,改地形要**从头重新生成世界**:
 * 修改在生成流程里对应的那一步套上(gen/terrainEdits.ts),侵蚀、河流、气候、群落照常跑,再重推文明 ——
 * 改过的地形和天然长出来的一样。州会重新划分、历史整个重来(扩张节拍仍按没改地形时的同一颗星球,见 civ/index.ts 的 planetTempo:
 * 远海、无人区里没人去的修改,历史和没改时一样),改名和干预按稳定键(按地块定位)尽量套上 ——
 * 指回同一块地方,套不上的不生效(先留着)。旧格式的键(`region:r123` 这类州号)仍按州号解析:州重新划分以后,
 * 它指到新划分里编号相同的那一州(多半不是原来那块地方),所以新写入的键一律是按地块的 c 格式。
 * 没有地形修改时生成结果和不改一模一样(逐字节)。
 *
 * | kind      | 意思       | pts(世界坐标)    | r(世界坐标)    | s(强度,1 = 普通)                |
 * |-----------|------------|--------------------|------------------|-----------------------------------|
 * | `volcano` | 火山       | 一个点 [x, y]      | 山体底半径       | 高低;放在海里 = 火山岛           |
 * | `range`   | 山脉       | 折线 [x0, y0, x1, y1, …] | 半宽       | 高低;穿过海面的一段成岛链 / 半岛 |
 * | `lake`    | 湖         | 一个点 [x, y]      | 湖的半径         | 深浅;点在海里不生效              |
 * | `raise`   | 抬起陆地   | 折线(画笔走过的路) | 画笔半径         | 抬起的新陆地的高低                |
 * | `sink`    | 沉成海     | 折线(画笔走过的路) | 画笔半径         | 沉下去的海的深浅                  |
 * | `river`   | 河         | 折线(从源头画到河口,反着画也行) | 河谷半宽 | 河谷的深浅;这一路一定画成河,流到海、湖或别的河为止 |
 * | `wet`     | 更湿       | 折线(画笔走过的路) | 画笔半径         | 多下多少雨(0.5 一点 / 1 明显 / 1.6 很多;下同)  |
 * | `dry`     | 更干       | 同上               | 同上             | 少下多少雨                        |
 * | `warm`    | 更暖       | 同上               | 同上             | 暖多少                            |
 * | `cold`    | 更冷       | 同上               | 同上             | 冷多少                            |
 * | `lift`    | 抬高       | 折线(笔按过的一个个点,按住不动时同一个点重复记) | 画笔半径 | 力度 0.05–1:每个点抬多少 |
 * | `lower`   | 压低       | 同上               | 同上             | 同上,往下压                      |
 * | `smooth`  | 平滑       | 同上               | 同上             | 每个点磨平多少                    |
 * | `flatten` | 抹平       | 同上               | 同上             | 每个点往第一个点的高度抹多少      |
 * | `setHeight` | 定高     | 折线(画笔走过的路) | 画笔半径         | 不用(存 1);海拔在 `h`(米),边缘在 `edge` |
 * | `delWater` | 删河湖    | 一个点 [x, y]      | 找河的最远距离   | 不用(存 1)                       |
 *
 * 可选字段:湖的 `e` = 湖岸曲折程度 0–1(没有 = 旧画法,岸线只轻轻扭一扭);气候四种的 `f` = 1 是圈起来填满(折线首尾连起来,圈里整片)。
 * 定高的 `h` = 海拔(米,整数,−6000–9000;必须有)、`edge` = 边缘 0 硬 / 1 适中 / 2 软(没有 = 适中)。
 * 气候四种不动地形,只在算完气候之后改那一片的降水 / 气温(之后河流、植被照常按改过的算)。
 * 高度五种(抬高、压低、平滑、抹平、定高)改的是最后的海拔:侵蚀、随机洼地之后、挖湖挖河之前套上(terrainEdits.ts 的 applyHeightPens),
 * 之后湖、河、气候、植被照新高度算;涂过的地方高过海平面就是陆地,低到海平面以下就是海。
 * 删河湖删掉程序生成的湖或河(terrainEdits.ts 的 lakeAt、riversAt;按先后一处处删):点落在湖里(离点最近的地块是湖)= 删这一整片湖,
 * 湖底填平到湖面下一点(排水不再积出湖,流进湖的河穿过去);不然删离点不超过 r 的河里最近的一条(作者画的河不算),
 * 连同流进它的支流(一层层往上)—— 这条河的整个上游流域流量压到成河门槛以下(推演里也不当河),下游不留断头河。
 * 找不到的不生效(先留着)。
 *
 * 世界坐标 = 主图(等距圆柱)原图的像素坐标(宽 2048、高 1024,左上角为原点;和精细度无关),取整存:
 * x 是经度(0 = 180°W,1024 = 0°,2048 = 180°E,绕一圈回到原处),y 是纬度(0 = 北极,512 = 赤道,1024 = 南极)。
 * 折线的第一个点 x 在 [0, 2048) 里,之后每个点按离上一个点近的那边写(跨 180° 经线的一笔 x 可以超出 [0, 2048),是连着的一笔)。
 * 读进来的列表先过 terrainEdits.ts 的 cleanTerrainOps(种类不认识、坐标不是数的丢掉;x 按上面的规则规整,y、大小、强度夹回范围内)。
 *
 * ## 地形大事
 *
 * WorldEdits.upheavals(可选,没有 = 一件也没有):世界建好以后,作者选一年让它发生的地形变化(火山喷发、地震抬升、海水漫进来)。
 * 和"地形修改"不同,地形修改是星球本来的样子(从第 0 年起就那样),地形大事是半路发生的:**那一年以前的历史和没有它时逐字节一致**,
 * 之后按新地形接着推(gen/civ/upheaval.ts)。第 k 件大事之后的地形 = 原来的地形修改 + 前 k 件大事的修改,从头生成(和改地形一样)。
 * 没有地形大事时生成结果和不加这一项一模一样(逐字节)。
 *
 * | 字段 | 意思                                                                                                 |
 * |------|------------------------------------------------------------------------------------------------------|
 * | year | 哪一年(整数,UPHEAVAL_YEARS 之间);那一年的年初发生,同一刻里先于别的一切事件(比干预还早)           |
 * | ops  | 这件大事里的地形修改(格式同上面"地形修改",按先后;只用 `volcano` 火山喷发、`raise` 地震抬升、`sink` 海水漫进来) |
 *
 * 同一年的几件按列表先后合成一件。读进来的列表先过 terrainEdits.ts 的 cleanUpheavals(年份不是数、一笔也不剩的丢掉;
 * 年份取整夹回范围内;最多 UPHEAVALS_MAX 件,每件最多 UPHEAVAL_OPS_MAX 笔)。
 *
 * ## 地形草图
 *
 * WorldEdits.sketch(可选,没有 = 没画):新建世界时「编辑地形」涂的草图 —— 程序照着它在板块上长出大陆、山脉(sketch.ts、
 * tectonics.ts 的 4b 步),是"星球"的一部分:和地形修改一样从头重新生成,但扩张节拍按照草图长出来的这颗星球标定
 * (地形修改再套在它上面时,planetTempo 也照草图生成)。没有草图时生成结果和不画一模一样(逐字节)。
 *
 * | 字段      | 意思                                                                                         |
 * |-----------|----------------------------------------------------------------------------------------------|
 * | rest      | 没涂的地方:`auto` = 照旧由程序定,`noNewLand` = 照旧由程序定、但和涂过的陆地连不上的陆地沉回海里(不长新陆地),`sea` = 都是海 |
 * | fill      | 程序补全(涂过的地方程序还加不加东西):不给 = 随意发挥(板块碰撞的山、古老山系、丘陵、裂谷、台地照加),`detail` = 只补细节(只加小起伏),`exact` = 完全照画(一点不加,一片低平原;涂的山地、丘陵、高原照样长) |
 * | coast     | 海岸线:0 = 贴着画的走,1 = 曲折,像真实的海岸(不给 = 0.6 适中)                               |
 * | strokes   | 笔画,按先后:{ kind, r, pts, h?, fill? } —— kind 是 `land` 陆地 / `hills` 丘陵 / `mountain` 山地 / `plateau` 高原 / `shelf` 浅海 / `sea` 海 / `isles` 群岛 / `erase` 擦掉(涂回没涂),r 是笔的半径,pts 是经过的点(和"地形修改"的折线同一套世界坐标和规则;一个点 = 点了一下),h 是山地的高低(0 低 / 2 高,不给 = 中),fill = 1 是圈起来填满(首尾连起来,圈里整片涂上) |
 * | image     | 导入的图片(可选):{ name, cells, at? } —— 图片本身不存,只存认出来的格子图:cells 是 512 × 256 格(一格 = 草图格子 2 × 2,世界坐标 4 × 4;逐行从北往南、每行从西往东),值同草图格子(0 没盖到、1 海、2 浅海、4 陆地、5 丘陵、7–9 山地低中高),行程编码 [个数 1–255, 值]… 再 base64;name 是图片的文件名(只用来显示);at = 铺在第几笔之后(前 at 笔先涂,后面的盖在它上面;不给 = 0) |
 *
 * | plates    | 「板块」页的改动(可选,plateEdits.ts):{ ops, image?, orogeny? } —— ops 按先后:`{ kind: 'set', pts: [x, y], dir?, speed?, crust? }` 改那里的板块(dir 往哪边漂,度,0 北 90 东;speed 每年几厘米,0–16;crust `continental` 陆壳 / `oceanic` 洋壳),`{ kind: 'cut', pts }` 沿画的线把线穿过的板块切开,`{ kind: 'merge', pts: [ax, ay, bx, by] }` 把 b 处的板块并进挨着的 a 处那块;都用世界坐标的点指板块。image = `{ name, cells }` 是照一张图分的板块(cells 编码同草图的 image,值是第几块,0 = 归给挨着的块;最先套上,每块的漂移按种子另取)。orogeny = false 是板块相撞时不造山(只长草图画的山) |
 *
 * 读进来的先过 sketch.ts 的 cleanSketch(笔画格式不对的丢掉,最多 SKETCH_MAX_STROKES 笔;图片的格子读不出来的丢掉;板块的改动格式不对的丢掉;一笔也没有、没导入图片、没改板块、没涂的又交给程序 = 没画)。
 *
 * ## 作者标记
 *
 * WorldEdits.marks(可选,没有 = 一个也没有):作者钉在地图上的标记("主角的故乡""第三卷打仗的那几州")——
 * 一个点或几个州,带名字、说明、颜色和年份。和改名一样只是记下来:不改变世界、不参与推演、和生成器版本无关。
 * 时间轴走到 [from, to] 这些年里(两头都算)地图上才画它;to 不给 = 一直都在。
 *
 * | 字段     | 意思                                                                                      |
 * |----------|-------------------------------------------------------------------------------------------|
 * | id       | 编号:这个世界里不重复的正整数(新建的 = 现有最大的 + 1;选中、撤销按它认)                   |
 * | title    | 名字(MARK_TITLE_MAX 个字以内)                                                            |
 * | note     | 说明(可以分行,MARK_NOTE_MAX 个字以内;没有 = 不写)                                       |
 * | color    | 颜色:MARK_COLORS 里的一种                                                                |
 * | from, to | 年份(整数,夹到 [0, INTERVENTION_YEAR_MAX];to 早于 from 的当作没给)                      |
 * | at       | 一个点:世界坐标 [x, y](和"地形修改"同一套坐标,x 规整到 [0, 2048));网格只由种子决定,改地形以后还是同一块地方,变成海了照样画 |
 * | regions  | 几个州:州键 `region:c4567`(按地块定位,见"稳定键";那块地方变成水了,那一州就不画)           |
 *
 * at 和 regions 有且只有一个(都给了按 regions)。读进来的列表先过 cleanMarks(格式不对的丢掉,编号重复的换一个新编号,
 * 最多留 MARKS_MAX 个,所有标记一共最多圈 MARK_REGIONS_TOTAL 个州)。
 *
 * ## 作者的人物
 *
 * WorldEdits.characters(可选,没有 = 一个也没有):作者放进这个世界的自己的人物 —— 名字、生卒、出生地、国家、身份、简介、
 * 一生的几段经历(每段可以勾上推演里的事和人)、亲友。和作者标记一样只是记下来:不改变世界、不参与推演、和生成器版本无关。
 * 字段、上限、怎么清理见 characters.ts。
 *
 * ## 推演年数
 *
 * WorldEdits.endYear(可选,没有 = END_YEAR_DEFAULT 即 3000 年):历史推到第几年,END_YEAR_DEFAULT–END_YEAR_MAX、整千年。
 * 推得更久的世界照样从第 0 年推起,前 3000 年和推 3000 年的世界几乎一样;扩张节拍、民族诞生、大宗教创立都按前 3000 年排,
 * 之后只是各国接着兴亡更替。新建世界时定,创建以后不再改(和地名风格一样)。3000 年的不写。
 *
 * ## 地名风格
 *
 * WorldEdits.nameMix(可选,没有 = 自动):整个世界的地名风格,每种语感占几份(gen/names 的 NameMix,如 { xianxia: 6, central: 4 })。
 * 各民族只在有份的几种里挑语感,每种占的地方尽量合比例(gen/civ/naming.ts 的 assignStyles)。只管起名 —— 推演在起名之前,
 * 历史和自动时逐字节一样,只是国名、城名、人名、山河这些名字换了;改名按位置记,照样套得上。
 * 新建世界时配,创建以后不再改(和地形一样)。自动 / 一份都没有的不写。
 *
 * ## 拓荒与起源
 *
 * WorldEdits.frontier(可选,没有 = 默认):民族扩散、国家扩张快慢,各种地形难走的程度(字段、档位、清理见 civ/frontier.ts)。
 * WorldEdits.origins(可选,没有 = 自动):自己选的文明起源,第一批民族从这几处出发、第 0 年出现(世界坐标的点,同地形修改;见 civ/frontier.ts)。
 * 两样都改变历史:新建世界时定,创建以后不再改(和推演年数一样);新建界面里先按默认推(只看星球),创建以后才按它们推。
 * 默认的不写,不写时推演和没有这两项逐字节一样。
 *
 * ## 文明种子
 *
 * WorldEdits.civSeed(可选,没有 = 等于地图种子):推演用的随机数从它取(州的划分、民族、国家、人物、地名、旗……),
 * 地图(地形、气候、河流)照旧只看 params.seed。同一张地图换一个文明种子,就是这张地图上另一段从第 0 年起的历史。
 * 没写时推演和没有这一项逐字节一样(加这一项以前的世界都没写)。写了的是"在一张地图上新开的历史":
 * 改过地形的,扩张节拍和城的人口折算按这张地图本身标定(civ/index.ts 的 generateCiv),不另按现在的生成器长一颗没改地形的星球。
 * 和拓荒、起源一样创建以后不再改。
 *
 * WorldEdits.map(可选):在一张地图上新开的历史,记着用的是哪张地图 —— sum = 那张地图的校验(生成出来的地图打成原件那一块的
 * SHA-256,gen/snapshot.ts;同一张地图逐字节一样才相同,不只是同一个种子),from = 从哪个世界新开的(浏览器里的世界编号,
 * 从新开的那段再新开,记的还是最早那个;"我的世界"按它把同一张地图上的几段历史放在一起)。只是记下来,不参与推演。
 * 新开时用的是原来那个世界的**初始**地图(参数、地形修改、草图;不带地形大事),推演从第 0 年起;
 * 原来的国家、人物、干预、地形大事、纪年、改名、作者标记和人物、改过的旗都不带(newHistoryEdits)。
 *
 * ## 纪年
 *
 * WorldEdits.era(可选,没有 = 按"第几年"写):年份的写法 —— 名字(默认「公元」)和元年是第几年,
 * 按年份定的("第 0 年是公元前 2500 年")或按一件事定的(那件事那一年就是元年;记下那件事,只用来在世界设定里显示)。
 * 和改名一样只是记下来:不改变世界、不参与推演、和生成器版本无关;年份(干预、标记、网址)照旧按第几年存。
 * 随时能改,改了不记撤销步。字段、写法见 era.ts。
 *
 * ## 月份
 *
 * WorldEdits.months(可选,没有 = 一年 12 个月):编年史、地图上的事件卡片、时间轴提示写到哪一月 ——
 * 0 = 只写年;2–36 = 一年几个月。和纪年一样只换写法,不参与推演;随时能改,改了不记撤销步。写法见 era.ts 的 monthOf。
 *
 * GENERATOR_VERSION:生成算法有改动、同种子会得到不同世界时加一(存档读档时核对,不一致就提示"来自旧版本"和变了什么;
 * 每一版改了什么记在下面的 GENERATOR_CHANGES,提示照它说)。
 *   2:名字按位置取(gen/civ/naming.ts、places.ts;地形、历史不变,默认的名字换了一遍),稳定键改按地块定位(c 格式)。
 *   3:推演里的随机数按位置锚取(gen/civ/rand.ts:州 = 治所地块,国家 / 城 / 民族 = 它们的锚点地块,不按编号),
 *      超越函数舍入到 24 位(不同 CPU、浏览器逐位一致);民族的语感、配色按发源地位置先后挑;
 *      地形里的随机小洼地(小湖)按地块取(world.ts)。小湖的位置和附近的河、群落变了,历史换了一遍。
 *   4:地形生成改成"一颗星球"(tectonics.ts):板块有大有小、默认 30 块,2~5 块大小悬殊的大陆 + 微大陆 + 岛弧 / 热点岛链 / 群岛,
 *      多尺度海岸;大陆内部平缓、山脉窄长、碰撞带后面有高原;海底有洋中脊、海沟、宽窄不一的大陆架。地形、历史全换了一遍。
 *   5:世界长在一颗球上:东西相连、有真正的南北极,主图是等距圆柱投影;约一半的世界有一块极地大陆。
 *      地形、历史、稳定键里的地块编号全换了一遍(旧存档照常打开,提示"来自旧版本",指不到的改名 / 干预标"暂未生效");
 *      地形修改的坐标按经纬度解释(x = 经度、y = 纬度),跨 180° 经线的笔画 x 可以超出 [0, 2048)。
 *   6:历史里有了人物(历代君主、战争里的统帅,Civ.people)和战役(没打下来的仗,史事 battle);
 *      疆域、兴亡、改朝换代都和 5 一样,编年史的句子里多了人名和"某某之战"。
 *   7:洋流(currents.ts):大陆两岸冷暖不同,气温、降水、群落、海冰跟着变;地形不变,历史换了一遍。
 *   8:改过地形的世界,扩张节拍按没改地形时的同一颗星球定(civ/index.ts 的 planetTempo),不再因为节拍被拨动而让全世界的历史错开。
 *      没改地形的世界和 7 逐字节相同;改过地形的世界历史换了一遍。
 *   9:君主有了世系(谁是谁的父亲,civ/lineage.ts),补上没即位的宗室;疆域、兴亡、君主和将领都和 8 一样,
 *      只是继位时年纪对不上的"其弟 / 其兄"改成了"其侄 / 叔父"这类(每个世界几十句)。
 *  10:国家之间有了邦交(civ/diplomacy.ts):畏强邻称臣纳贡、战败奉表称臣、结盟共御强敌、盟国援战或坐视不救、背盟、
 *      藩属乘乱绝贡自立、宗主讨伐或兼并藩属;开战记下由头,议和写清称臣和割了哪几州。地形不变,历史重新推演。
 *  11:君主有了倾向(开拓、好战、发展、重商,各 0–100,civ/rulers.ts),国家扩张前先算划不划算:荒漠、苔原、高山、离国都太远的地方多留给部落;
 *      倾向也管开战、议和、称臣和亲征。有地形大事的世界:大事以后还在的城,港口、人口上限照新地形换值;沉过海的城不再重建;
 *      发源州沉了的民族不再兴起。地形不变,历史重新推演。
 *  12:每一朝有了几位名臣(civ/officials.ts:文臣,有字号、籍贯、官职、生平),将领也有了字号、籍贯、官职、生平;
 *      将领不再重名:和此前的君主、先前的将领名臣尽量不撞,至少和本国君主、前后几百年的同名人物错开;
 *      疆域、兴亡、君主都和 11 一样,编年史里议和、幼主即位、遇弑迎立、称王称帝几类写上了经手的名臣,撞了名的将领换了名字。
 *  13:宜居度看"养得活多少人"(civ/habitat.ts):热带雨林、温带雨林降下来,季雨林、草原、稀树草原升上去,河的加分按当地降水打折,
 *      大河下游的低平处(冲积平原、三角洲)加分;州的人口 = 城 + 乡村(civ/growth.ts 的 regionPopulationAt),城整体放大、国都更大。
 *      地形不变,历史重新推演。
 *  14:地形上几处不自然的水:四面是陆、不通外洋的"内海"(碎屑填成陆地,离外洋近的凿海峡接通,远的填成平原,gen/inlandSea.ts);
 *      紧挨着海的"湖"(其实是低于海平面的海边洼地,垫到海平面);湖中心周围全是水的一小块地(淹成湖,不再单独成州)。
 *      陆地、山、气候大体不变,个别地方的海陆、湖、河变了,历史重新推演。
 *  15:立国更早(人口上限够立国的城不必长到很大,第一批国家在几百年里出现,civ/polities.ts),
 *      强国边上的部落受它影响提早立国(边缘立国,civ/politics.ts 的看部落地带;Polity.mentor);
 *      民族往气候不同的地方走得更慢(海洋民族更甚,civ/cultures.ts),隔山隔海或分属不同国家几百年的一支分化成新民族
 *      (civ/assimilation.ts 的看分化;Culture.parent,族名带母族的名字)。地形不变,历史重新推演。
 *  16:跨海只走航线:州之间的航线只连各州的出海口(和地图上画的航线同一套连法,civ/regions.ts 的 seaLanes),
 *      推演里走过的海峡、航线都画出来(civ/routes.ts 的 usedLanes);到航海时代(默认第 1800.5 年,civ/polities.ts 的 sailsOcean)
 *      有港口的普通国家也沿航线往海外扩张、隔海打仗。地形不变,历史重新推演。
 *  17:发展度挪进推演里,每 20 年算一步并反过来影响历史(civ/development.ts):城和乡村的人口上限随所在州的生产能力变
 *      (Settlement.devCap),打仗的国力乘上按动员能力定的军力系数,普通国家各在自己国都的运输能力够了那年起才能远洋
 *      (Polity.sail;不再有全世界统一的航海时代);跨时代要几个条件同时满足(国家、行政、太平、地理),编年史记下世上第一次的发明。
 *      地形不变,历史重新推演。
 *  18:降水分夏半年、冬半年两次算再平均(gen/climate.ts 的 SEASON_WIND):夏天信风伸到 35° 上下,把水汽从大陆东岸送进去(季风),
 *      东岸不再是一直通到海边的沙漠;副热带看空气从哪种洋流上吹来,暖流那边(大陆东岸)湿、寒流那边(大陆西岸)更干;
 *      温带雨林要年降水 2300 毫米以上(原来 1700,迎风坡上到处是);冰盖上不再流河;成河门槛从 14 降到 10,河段多了约一半。
 *      陆地、山、湖不变,气候、群落、河流变了,历史重新推演。
 *  19:仗短而狠(civ/wars.ts):一场仗中位几年到十来年,打下一州可乘胜连下几州(势如破竹),州易手后几年就能再被夺回(拉锯),
 *      丢了地的国家更想收复故土、休战期短了;军力系数高的国家远征打折少,强国能越打越远。地形不变,历史重新推演。
 *  20:动荡、饥荒、民变、大崩解(civ/unrest.ts):国家越大、边远异族越多、王朝越老、刚闹了饥荒越乱;
 *      人口顶到上限的城碰上灾年会闹饥荒(人口掉一截),饥民可能起事、和朝廷打一场(被讨平、割据一方或攻破都城);
 *      动荡到顶的大国一下子散成几块(各地自立 / 诸州残破 / 散回部落)。地形不变,历史重新推演。
 *  21:瘟疫(civ/plague.ts):偶尔从大城、港口起疫,一年年沿相邻的州、海峡、航线传开,染疫的城人口骤降;
 *      很少见的大瘟疫循着航线传遍几块大陆。疫区国力下降、更动荡。地形不变,历史重新推演。
 *  22:治乱循环(civ/unrest.ts、wars.ts、politics.ts):称霸一块大陆的大国更容易大崩解(盛极而衰),一般的大国少崩一些;
 *      边地零星自立少了一半,强国远征打折少、一场仗想拿的州多了,崩解以后邻国、新兴的国家更快收拾残局、重新统一。
 *      地形不变,历史重新推演。
 *  23:接着推不改过去(civ/index.ts 的 continueCiv):推完以后的整理(民族、州、城、国家的名字和配色,人物,道路,信仰)
 *      只看每样东西出现以前的历史,推到 T1 再接着推和一口气推完一样;疆域、兴亡不变,名字、配色、人物编号、道路、信仰的传播换了一遍。
 */
import type { Civ, Culture, Faith, Person, Place, Polity, Regions, Settlement } from './civ/types';
import type { AuthorCharacter } from './characters';
import { polityRootAt } from './civ/growth';
import { TERRAIN_H, TERRAIN_W } from './terrainEdits';
import type { SketchEdit } from './sketch';
import type { NameMix } from './names/mix';
import type { Era } from './era';
import type { Frontier, Origins } from './civ/frontier';

/** 生成器版本:生成算法有改动、同种子会得到不同世界时加一(存档读档时核对);加一时在 GENERATOR_CHANGES 里补一条 */
export const GENERATOR_VERSION = 23;

/**
 * 一版生成器的改动有多大(从小到大):打开旧存档、旧链接时,按跨过的几版里最大的那一种说清变了什么(savefile.ts 的 versionNote)
 *   names      地形、历史不变,默认的名字换了
 *   chronicle  疆域、兴亡不变,编年史里添了内容
 *   history    地形、气候不变,历史重新推演
 *   climate    陆地和山不变,气候、河流、历史变了
 *   terrain    地形有局部变化,历史重新推演
 *   planet     整颗星球重新生成
 */
export type GeneratorChange = 'names' | 'chronicle' | 'history' | 'climate' | 'terrain' | 'planet';

/** 每一版(加到这个号时)改了什么;edited = 只有改过地形的世界变了,没改地形的和上一版一样 */
export const GENERATOR_CHANGES: Readonly<Record<number, { change: GeneratorChange; edited?: true }>> = {
  2: { change: 'names' },
  3: { change: 'terrain' },
  4: { change: 'planet' },
  5: { change: 'planet' },
  6: { change: 'chronicle' },
  7: { change: 'climate' },
  8: { change: 'history', edited: true },
  9: { change: 'chronicle' },
  10: { change: 'history' },
  11: { change: 'history' },
  12: { change: 'chronicle' },
  13: { change: 'history' },
  14: { change: 'terrain' },
  15: { change: 'history' },
  16: { change: 'history' },
  17: { change: 'history' },
  18: { change: 'climate' },
  19: { change: 'history' },
  20: { change: 'history' },
  21: { change: 'history' },
  22: { change: 'history' },
  23: { change: 'history' },
};

/** 干预的种类(见文件头的表) */
export type InterventionKind = 'protect' | 'ally' | 'declare' | 'unity' | 'cede' | 'found' | 'move' | 'halt';

/** 一条干预(字段、年份语义见文件头的表;a、b 是国家的稳定键 `polity:…`,region 是州键 `region:…`,city 是城键 `settlement:…`) */
export type Intervention =
  | { kind: 'protect'; a: string; from: number; until?: number }
  | { kind: 'ally'; a: string; b: string; from: number; until?: number }
  | { kind: 'declare'; a: string; b: string; from: number }
  | { kind: 'unity'; a: string; from: number }
  | { kind: 'cede'; a: string; region: string; from: number; permanent?: true }
  | { kind: 'found'; region: string; from: number; name?: string }
  | { kind: 'move'; a: string; city: string; from: number }
  | { kind: 'halt'; a: string; from: number; until?: number };

/** 地形修改的种类(见文件头"地形修改"的表) */
export type TerrainKind =
  | 'volcano'
  | 'range'
  | 'lake'
  | 'raise'
  | 'sink'
  | 'river'
  | 'wet'
  | 'dry'
  | 'warm'
  | 'cold'
  | 'lift'
  | 'lower'
  | 'smooth'
  | 'flatten'
  | 'setHeight'
  | 'delWater';

/** 一处地形修改(字段见文件头"地形修改"的表;坐标、大小都是世界坐标) */
export interface TerrainOp {
  kind: TerrainKind;
  /** 火山、湖、删河湖 = [x, y];山脉、画笔 = 折线 [x0, y0, x1, y1, …] */
  pts: number[];
  /** 大小:火山底半径 / 湖半径 / 山脉半宽 / 画笔半径 / 删河湖找河的最远距离 */
  r: number;
  /** 强度(1 = 普通) */
  s: number;
  /** 湖岸曲折程度 0–1(只有湖有;没有 = 旧画法,岸线只轻轻扭一扭) */
  e?: number;
  /** 1 = 圈起来填满(只有气候四种有) */
  f?: 1;
  /** 定高的海拔(米,只有定高有) */
  h?: number;
  /** 定高的边缘:0 硬 / 1 适中 / 2 软(只有定高有;没有 = 适中) */
  edge?: 0 | 1 | 2;
}

/** 一件地形大事(字段见文件头"地形大事") */
export interface Upheaval {
  /** 哪一年 */
  year: number;
  /** 这件大事里的地形修改(按先后) */
  ops: TerrainOp[];
}

export interface WorldEdits {
  /** 改名:稳定键 → 新名字 */
  names: Record<string, string>;
  /** 从 AI 起名里挑的名字(见文件头"改名");没有 = 一个也没有 */
  aiNames?: Record<string, AiNameMark>;
  /** 干预(按下达的先后;见文件头"干预") */
  interventions: Intervention[];
  /** 地形修改(按先后;见文件头"地形修改") */
  terrain: TerrainOp[];
  /** 地形草图(见文件头"地形草图");没有 = 没画 */
  sketch?: SketchEdit;
  /** 地形大事(按添加的先后;见文件头"地形大事");没有 = 一件也没有 */
  upheavals?: Upheaval[];
  /** 作者标记(按添加的先后;见文件头"作者标记");没有 = 一个也没有 */
  marks?: AuthorMark[];
  /** 改过的国旗:稳定键 → 旗的写法(见文件头"改旗");没有 = 一面也没改 */
  flags?: Record<string, string>;
  /** 作者的人物(按新建的先后;见文件头"作者的人物"、characters.ts);没有 = 一个也没有 */
  characters?: AuthorCharacter[];
  /** 整个世界的地名风格:语感 → 份数(见文件头"地名风格");没有 = 自动 */
  nameMix?: NameMix;
  /** 历史推到第几年(见文件头"推演年数");没有 = 3000 */
  endYear?: number;
  /** 拓荒:民族扩散、国家扩张快慢,地形难走程度(见文件头"拓荒与起源");没有 = 默认 */
  frontier?: Frontier;
  /** 自己选的文明起源(见文件头"拓荒与起源");没有 = 自动 */
  origins?: Origins;
  /** 文明种子(见文件头"文明种子");没有 = 等于地图种子 */
  civSeed?: number;
  /** 这段历史用的是哪张地图(见文件头"文明种子");没有 = 不是在别的世界的地图上新开的 */
  map?: MapRef;
  /** 纪年(见文件头"纪年"、era.ts);没有 = 按"第几年"写 */
  era?: Era;
  /** 一年几个月(见文件头"月份");0 = 只写年;没有 = 12 */
  months?: number;
}

/** 推演年数:默认、最多、一格(见文件头"推演年数") */
export const END_YEAR_DEFAULT = 3000;
export const END_YEAR_MAX = 60000;
export const END_YEAR_STEP = 1000;

/** 推演年数清理:不是数字 = undefined;夹在 END_YEAR_DEFAULT–END_YEAR_MAX,取整到 END_YEAR_STEP;等于默认 = undefined(不写) */
export function cleanEndYear(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const y = Math.min(END_YEAR_MAX, Math.max(END_YEAR_DEFAULT, Math.round(v / END_YEAR_STEP) * END_YEAR_STEP));
  return y === END_YEAR_DEFAULT ? undefined : y;
}

/** 文明种子清理:整数(和地图种子同一范围)才认,别的 = undefined(按地图种子推) */
export function cleanCivSeed(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isSafeInteger(v) ? v : undefined;
}

/** 这个世界推演用的文明种子(没写 = 地图种子) */
export function civSeedOf(edits: Pick<WorldEdits, 'civSeed'>, mapSeed: number): number {
  return cleanCivSeed(edits.civSeed) ?? mapSeed;
}

/** 一段历史用的是哪张地图(见文件头"文明种子") */
export interface MapRef {
  /** 地图的校验(地图那块原件的 SHA-256,十六进制);新开以后第一次推完才知道的,之前没有 */
  sum?: string;
  /** 从哪个世界新开的(世界编号) */
  from?: string;
}

/** 地图记录清理:校验是 64 位十六进制、编号是不带控制字符的短字符串才留;一样都不剩 = undefined */
export function cleanMapRef(v: unknown): MapRef | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const sum = typeof o.sum === 'string' && /^[0-9a-f]{64}$/.test(o.sum) ? o.sum : undefined;
  // eslint-disable-next-line no-control-regex
  const from = typeof o.from === 'string' && o.from.length > 0 && o.from.length <= 400 && !/[\u0000-\u001f\u007f]/.test(o.from) ? o.from : undefined;
  return sum || from ? { ...(sum ? { sum } : {}), ...(from ? { from } : {}) } : undefined;
}

/** 两份地图记录一样(都没有也算) */
export function sameMapRef(a: MapRef | undefined, b: MapRef | undefined): boolean {
  return (a?.sum ?? '') === (b?.sum ?? '') && (a?.from ?? '') === (b?.from ?? '');
}

/** 在一张地图上新开一段历史时可以另选的(不给 = 默认:地名风格自动、推演 3000 年) */
export interface NewHistoryOptions {
  civSeed: number;
  nameMix?: NameMix;
  endYear?: number;
  /** 地图的校验(知道就给) */
  sum?: string;
  /** 从哪个世界新开的 */
  from: string;
}

/**
 * 在 base 这个世界的地图上新开一段历史的修改:只带初始地图(地形修改、草图),外加新的文明种子、地图记录和另选的地名风格、推演年数。
 * 原来的国家、人物、干预、地形大事、纪年、月份、改名、AI 起名、作者标记和人物、改过的旗、拓荒和起源一律不带。
 * base 自己是新开的(有 map.from)时,from 记最早那个世界
 */
export function newHistoryEdits(base: WorldEdits, o: NewHistoryOptions): WorldEdits {
  const out: WorldEdits = {
    names: {},
    interventions: [],
    terrain: (base.terrain ?? []).map((x) => ({ ...x, pts: x.pts.slice() })),
  };
  if (base.sketch) out.sketch = JSON.parse(JSON.stringify(base.sketch)) as SketchEdit;
  if (o.nameMix) out.nameMix = { ...o.nameMix };
  const endYear = cleanEndYear(o.endYear);
  if (endYear) out.endYear = endYear;
  out.civSeed = o.civSeed;
  out.map = cleanMapRef({ sum: o.sum, from: cleanMapRef(base.map)?.from ?? o.from });
  return out;
}

/** 这个世界推到第几年(没写 = 默认) */
export function endYearOf(edits: Pick<WorldEdits, 'endYear'>): number {
  return cleanEndYear(edits.endYear) ?? END_YEAR_DEFAULT;
}

/** 作者标记的颜色(界面上的六种:红、橙、绿、蓝、紫、青) */
export const MARK_COLORS = ['red', 'orange', 'green', 'blue', 'purple', 'teal'] as const;
export type MarkColor = (typeof MARK_COLORS)[number];
/** 标记的颜色:六种颜色,或"无色"(none:不画图钉和铺色,名字像地图上的地名) */
export type MarkTint = MarkColor | 'none';
/** 名字的字号档(中 = 不写) */
export const MARK_SIZES = ['s', 'l', 'xl'] as const;
export type MarkSizeSet = (typeof MARK_SIZES)[number];

/** 一个作者标记(字段见文件头"作者标记") */
export interface AuthorMark {
  id: number;
  title: string;
  note?: string;
  color: MarkTint;
  /** 名字的字号:s 小 / l 大 / xl 特大;没有 = 中 */
  size?: MarkSizeSet;
  /** 从哪年起(含) */
  from: number;
  /** 到哪年止(含);没有 = 一直都在 */
  to?: number;
  /** 一个点:世界坐标 [x, y] */
  at?: [number, number];
  /** 几个州:州键 */
  regions?: string[];
}

/** 一个从 AI 起名里挑的名字:挑的那个名字、挑之前的名字(没改过 = 不写) */
export interface AiNameMark {
  name: string;
  was?: string;
}

export const EMPTY_EDITS: WorldEdits = Object.freeze({
  names: Object.freeze({}) as Record<string, string>,
  interventions: Object.freeze([]) as unknown as Intervention[],
  terrain: Object.freeze([]) as unknown as TerrainOp[],
});

export type KeyKind = 'polity' | 'settlement' | 'place' | 'culture' | 'dynasty' | 'region' | 'faith' | 'person';

export interface ResolvedKey {
  kind: KeyKind;
  /** 国家 / 城 / 地理实体 / 民族 / 州的编号(朝代:所属国家的编号) */
  id: number;
  /** 朝代:第几朝 */
  index?: number;
}

// ---------------------------------------------------------------------------
// 稳定键 ↔ 编号(每个 Civ 算一次)

/** 国家 / 城 / 民族 / 信仰:按州编"第几个"的几类 */
type CountedKind = 'polity' | 'settlement' | 'culture' | 'faith';

interface KeyIndex {
  polity: string[];
  settlement: string[];
  place: string[];
  culture: string[];
  faith: string[];
  /** 地理实体的键 → 编号 */
  places: Map<string, number>;
  /** 按州定位的内部键(`polity:123#0`,123 = 州号)→ 编号 */
  byRegion: Map<string, number>;
}

const indexCache = new WeakMap<Civ, KeyIndex>();

/** 按 group 分组,组里按 order 排好,各自编上"第几个":返回每个元素的序号 */
function counted<T>(list: readonly T[], group: (x: T, i: number) => number | string, order: (a: T, b: T) => number): number[] {
  const groups = new Map<number | string, number[]>();
  list.forEach((x, i) => {
    const a = group(x, i);
    const g = groups.get(a);
    if (g) g.push(i);
    else groups.set(a, [i]);
  });
  const out = new Array<number>(list.length);
  for (const g of groups.values()) {
    g.sort((i, j) => order(list[i], list[j]) || i - j);
    g.forEach((i, n) => (out[i] = n));
  }
  return out;
}

function keyIndex(civ: Civ): KeyIndex {
  let ix = indexCache.get(civ);
  if (ix) return ix;
  const S = civ.settlements;
  const seat = keySeats(civ.regions);
  /** 州 → 键里的位置锚:治所地块(`c4567`);没有这州(不该发生)按州号 */
  const at = (r: number) => (r >= 0 && r < seat.length ? `c${seat[r]}` : `r${r}`);
  const byRegion = new Map<string, number>();
  const build = <T>(kind: CountedKind, list: readonly T[], region: (x: T) => number, order: (a: T, b: T) => number): string[] => {
    const rs = list.map(region);
    const ns = counted(list, (_, i) => rs[i], order);
    return list.map((_, i) => {
      byRegion.set(`${kind}:${rs[i]}#${ns[i]}`, i);
      return `${kind}:${at(rs[i])}#${ns[i]}`;
    });
  };
  const polity = build('polity', civ.polities, (p) => S[p.capital]?.region ?? -1, (a, b) => a.founded - b.founded);
  const settlement = build('settlement', S, (s) => s.region, (a, b) => a.founded - b.founded);
  const culture = build('culture', civ.cultures, (c) => c.hearth, (a, b) => a.born - b.born);
  const faith = build('faith', civ.religion?.faiths ?? [], (f) => faithRegion(civ, f), (a, b) => (a.founded ?? -1) - (b.founded ?? -1));
  const placeAt = (p: Place, i: number) => {
    const c = p.keyCell ?? p.cell;
    return `place:${p.kind}@${c !== undefined ? `c${c}` : `i${i}`}`;
  };
  const pn = counted(civ.places, placeAt, () => 0);
  const place = civ.places.map((p, i) => `${placeAt(p, i)}#${pn[i]}`);
  const places = new Map<string, number>();
  place.forEach((k, id) => places.set(k, id));
  ix = { polity, settlement, place, culture, faith, places, byRegion };
  indexCache.set(civ, ix);
  return ix;
}

export function polityKey(civ: Civ, id: number): string {
  return keyIndex(civ).polity[id];
}

export function settlementKey(civ: Civ, id: number): string {
  return keyIndex(civ).settlement[id];
}

/**
 * 地理实体的键。Place 本身不知道自己在 civ.places 里排第几,所以同种类同锚点有两个以上的(极少见)、
 * 或者没有锚点地块的,要用 placeKeyOf(civ, 下标) 才能分清;这里按"第 0 个"算
 */
export function placeKey(place: Place): string {
  const c = place.keyCell ?? place.cell;
  return `place:${place.kind}@${c !== undefined ? `c${c}` : 'i0'}#0`;
}

/** 地理实体的键(按 civ.places 的下标;能分清同种类同锚点的几个) */
export function placeKeyOf(civ: Civ, id: number): string {
  return keyIndex(civ).place[id];
}

export function cultureKey(civ: Civ, id: number): string {
  return keyIndex(civ).culture[id];
}

export function faithKey(civ: Civ, id: number): string {
  return keyIndex(civ).faith[id];
}

/**
 * 人物的稳定键:国家的稳定键 + 身份 + 名字 + 生年(重推历史后同一国、同名、同年生的还是他;推演变了、指不到就算了)。
 * 名字用生成时的名字(Person.defaultName,改过名的才有):给人物改名不会让键变。
 * 同一国、同身份、同名、同年生的不止一个(西幻的君主会重名):第二个起后面加 #1、#2……(按人物编号的先后)
 */
export function personKey(civ: Civ, id: number): string {
  return personKeys(civ)[id] ?? '';
}

const personKeyCache = new WeakMap<object, { keys: string[]; byKey: Map<string, number> }>();

/** 每个人的稳定键(下标 = 人物编号;国家没了的 = '')。按人物列表存 */
function personIndex(civ: Civ): { keys: string[]; byKey: Map<string, number> } {
  const list = civ.people ?? [];
  let ix = personKeyCache.get(list);
  if (ix && ix.keys.length === list.length) return ix;
  const keys: string[] = [];
  const byKey = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const x of list) {
    if (!civ.polities[x.polity]) {
      keys[x.id] = '';
      continue;
    }
    const base = `person:${polityKey(civ, x.polity)}|${x.role}|${x.defaultName ?? x.name}|${Math.round(x.born)}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const k = n ? `${base}#${n}` : base;
    keys[x.id] = k;
    byKey.set(k, x.id);
  }
  ix = { keys, byKey };
  personKeyCache.set(list, ix);
  return ix;
}

const personKeys = (civ: Civ) => personIndex(civ).keys;

/** 按人物的稳定键在(重推过的)历史里找回这个人;找不到 = −1 */
export function resolvePersonKey(civ: Civ, key: string): number {
  if (!civ.people?.length) return -1;
  const ix = personIndex(civ);
  const hit = ix.byKey.get(key);
  if (hit !== undefined) return hit;
  // 将领后来按不重名的规则改过名(旧存档里记的是原来的名字):同一国、同年生的将领只有一位,就是他
  const m = /^(person:.+\|general)\|[^|]+\|(-?\d+)(?:#\d+)?$/.exec(key);
  if (!m) return -1;
  const head = m[1] + '|';
  const tail = '|' + m[2];
  const found = ix.keys.flatMap((k, id) => (k.startsWith(head) && (k.endsWith(tail) || k.includes(tail + '#')) ? [id] : []));
  return found.length === 1 ? found[0] : -1;
}

/** 信仰的位置锚:大教 = 圣城所在的州,教派 = 分出时那国国都所在的州,民间信仰 = 民族的发源州 */
function faithRegion(civ: Civ, f: Faith): number {
  if (f.kind === 'folk') return civ.cultures[f.culture ?? f.id]?.hearth ?? -1;
  const s = f.kind === 'great' ? f.holy : f.seat;
  return s !== undefined ? (civ.settlements[s]?.region ?? -1) : -1;
}

export function dynastyKey(civ: Civ, polity: number, index: number): string {
  return `dynasty:${polityKey(civ, polity).slice('polity:'.length)}/${index}`;
}

/** 州的键:`region:c{治所地块}`(改地形、州重新划分以后,指"现在包含这块地的那一州") */
export function regionKey(civ: Civ, region: number): string {
  const seat = keySeats(civ.regions);
  return region >= 0 && region < seat.length ? `region:c${seat[region]}` : `region:r${region}`;
}

/**
 * 稳定键按哪份"地块 → 州"、"州 → 治所"定位:平常就是州的划分本身;地形大事以后用每块地、每州最早的样子
 * (Regions.keyOf / keySeat:沉进海里的地方、换过的治所照样指回同一州,大事前后各段的键一样)
 */
export const keyCells = (r: Pick<Regions, 'of' | 'keyOf'>): ArrayLike<number> => r.keyOf ?? r.of;
export const keySeats = (r: Pick<Regions, 'seat' | 'keySeat'>): ArrayLike<number> => r.keySeat ?? r.seat;

/** 州的位置锚:`r123`(旧格式,州号)/ `c4567`(地块)→ 现在的州号;地块在水上、超出范围 = −1(州号不查州数) */
function regionOfRef(ref: string, of: ArrayLike<number>): number {
  const id = Number(ref.slice(1));
  if (ref[0] === 'r') return id;
  return id >= 0 && id < of.length ? of[id] : -1;
}

const REGION_KEY = /^region:([rc]\d{1,7})$/;
const COUNTED_KEY = /^(polity|settlement|culture|faith):(r-?\d{1,7}|c\d{1,7})#(\d{1,5})$/;

/**
 * 州键 → 现在的州号:`region:c4567` 找包含地块 4567 的州(水上 = −1);旧格式 `region:r123` 就是 123(不查州数,推演时再核对)。
 * 格式不对 = −1。of = Regions.of(地块 → 州)
 */
export function regionOfKey(key: string, of: ArrayLike<number>): number {
  const m = REGION_KEY.exec(key);
  return m ? regionOfRef(m[1], of) : -1;
}

/**
 * 国家 / 城 / 民族的键 → 按州定位的内部键 `polity:123#0`(123 = 现在的州号;新格式先找包含那个地块的州,旧格式直接是州号)。
 * 格式不对、地块在水上 = null。推演里的增量解析(civ/interventions.ts)和 resolveKey 共用它
 */
export function keyByRegion(key: string, of: ArrayLike<number>): string | null {
  const m = COUNTED_KEY.exec(key);
  if (!m) return null;
  const r = regionOfRef(m[2], of);
  if (r < 0 && m[2][0] === 'c') return null;
  return `${m[1]}:${r}#${Number(m[3])}`;
}

/** 键 → 这个世界里的实体;格式不对、找不到的 = null(新旧两种格式都认,见文件头"稳定键") */
export function resolveKey(civ: Civ, key: string): ResolvedKey | null {
  if (typeof key !== 'string') return null;
  const ix = keyIndex(civ);
  if (key.startsWith('region:')) {
    const id = regionOfKey(key, keyCells(civ.regions));
    return id >= 0 && id < civ.regions.count ? { kind: 'region', id } : null;
  }
  if (key.startsWith('place:')) {
    const id = ix.places.get(key);
    return id !== undefined ? { kind: 'place', id } : null;
  }
  if (key.startsWith('person:')) {
    const id = resolvePersonKey(civ, key);
    return id >= 0 ? { kind: 'person', id } : null;
  }
  if (key.startsWith('dynasty:')) {
    const cut = key.lastIndexOf('/');
    if (cut < 0) return null;
    const index = Number(key.slice(cut + 1));
    const p = resolveKey(civ, `polity:${key.slice('dynasty:'.length, cut)}`);
    if (!p || p.kind !== 'polity' || !Number.isInteger(index) || index < 0 || !civ.polities[p.id].dynasties?.[index]) return null;
    return { kind: 'dynasty', id: p.id, index };
  }
  const k = keyByRegion(key, keyCells(civ.regions));
  const id = k === null ? undefined : ix.byRegion.get(k);
  return id !== undefined ? { kind: key.slice(0, key.indexOf(':')) as CountedKind, id } : null;
}

/** 旧格式的键:种类 + `r` + 州号 + 后面的部分(`#0`、`#0/2`,州键没有) */
const LEGACY_KEY = /^(polity|settlement|culture|dynasty|region):r(-?\d{1,7})((?:#\d{1,5}(?:\/\d{1,5})?)?)$/;

/** 一个键:旧格式(州号)→ c 格式(那一州的治所地块);不是旧格式、州号超出范围的 = null */
function upgradeKey(key: unknown, seat: ArrayLike<number>): string | null {
  if (typeof key !== 'string') return null;
  const m = LEGACY_KEY.exec(key);
  if (!m) return null;
  const r = Number(m[2]);
  if (!(r >= 0 && r < seat.length)) return null;
  return `${m[1]}:c${seat[r]}${m[3]}`;
}

/**
 * 把修改里的旧键(`region:r123`、`polity:r123#0`、`settlement:r123#1`、`culture:r45#0`、`dynasty:r123#0/2`)
 * 就地换成 c 格式(`r123` → `c{第 123 州的治所地块}`):改名的键、干预里的国家 / 州 / 城。
 * seat = 读档那一刻生成的世界的 Regions.seat(州只由地形定,和历史无关;见文件头"旧键")。
 * 升级后的键和已有的 c 格式键撞了(同一个东西改过两次名):留 c 格式那个(后写的)。州号超出范围的旧键原样留着(本来就找不到)。
 * 一个旧键都没有时返回原对象(同一个对象)
 */
export function upgradeLegacyKeys(edits: WorldEdits, seat: ArrayLike<number>): WorldEdits {
  let names = edits.names;
  let changed = false;
  const up: [string, string][] = [];
  for (const k in edits.names) {
    const c = upgradeKey(k, seat);
    if (c !== null) up.push([k, c]);
  }
  if (up.length) {
    names = {};
    const legacy = new Set(up.map(([k]) => k));
    for (const k in edits.names) if (!legacy.has(k)) names[k] = edits.names[k];
    for (const [k, c] of up) if (!(c in names)) names[c] = edits.names[k];
    changed = true;
  }
  let interventions = edits.interventions;
  const list = edits.interventions.map((v) => {
    const o = v as unknown as Record<string, unknown>;
    let w: Record<string, unknown> | null = null;
    for (const f of ['a', 'b', 'region', 'city']) {
      const c = upgradeKey(o[f], seat);
      if (c === null) continue;
      w ??= { ...o };
      w[f] = c;
    }
    return (w ?? v) as Intervention;
  });
  if (list.some((v, i) => v !== edits.interventions[i])) {
    interventions = list;
    changed = true;
  }
  return changed ? { ...edits, names, interventions } : edits;
}

// ---------------------------------------------------------------------------
// 改名

/** 复国国名的前缀(和 gen/civ/naming.ts 的 RESTORE_PREFIX_* 一致;这里不引起名器,免得主线程打包地名词库) */
const RESTORE_PREFIXES = '后北南东西新';

/** "大安" → "安"(中式国号里"安"和"大安"算同一个名字,复国叫"后安") */
function bare(root: string): string {
  return [...root].length === 2 && root[0] === '大' ? root.slice(1) : root;
}

/** 名字最长几个字 */
export const NAME_MAX = 16;

/** 这个键现在的名字是不是从 AI 起名里挑的(之后自己改过、恢复过默认的不算) */
export function isAiName(edits: WorldEdits, key: string): boolean {
  const m = edits.aiNames?.[key];
  return !!m && edits.names[key] === m.name;
}

/** 现在用着的 AI 起的名字有哪几个(稳定键) */
export function aiNameKeys(edits: WorldEdits): string[] {
  return Object.keys(edits.aiNames ?? {}).filter((k) => isAiName(edits, k));
}

/**
 * 记下 key 的名字换成了 name 以后的 aiNames:从 AI 起名里挑的(ai = true)记一笔,挑之前的名字留着
 * (上一个也是 AI 起的就沿用它的 was);别的改名(自己改、恢复默认)把这一笔去掉。一笔都不剩 = undefined
 */
export function markAiName(edits: WorldEdits, key: string, name: string | null, ai: boolean): Record<string, AiNameMark> | undefined {
  const cur = edits.aiNames;
  if (ai && name) {
    const was = isAiName(edits, key) ? cur![key].was : edits.names[key];
    return { ...cur, [key]: was === undefined ? { name } : { name, was } };
  }
  if (!cur || !(key in cur)) return cur;
  const next = { ...cur };
  delete next[key];
  return Object.keys(next).length ? next : undefined;
}

/** 导出时"换回原名"用的改名表:AI 起的名字换回挑之前的(没改过 = 去掉,用生成时的名字) */
export function namesWithoutAi(edits: WorldEdits): Record<string, string> {
  const keys = aiNameKeys(edits);
  if (!keys.length) return edits.names;
  const out = { ...edits.names };
  for (const k of keys) {
    const was = edits.aiNames![k].was;
    if (was === undefined) delete out[k];
    else out[k] = was;
  }
  return out;
}

/** 国名词根末尾常被顺手打上的国号(打"索拉特王国"就当是"索拉特";长的在前) */
const POLITY_SUFFIXES = ['共和国', '大汗国', '王朝', '皇朝', '帝国', '王国', '汗国', '城邦', '国', '部'];

/**
 * 用户输入的名字 → 存进 names 的名字:去掉首尾空白和控制字符,超长截断;
 * 国家 / 东方朝代去掉末尾顺手打上的国号("秦国" → "秦"),西幻朝代去掉"王朝",民族去掉"族"(剩下不到一个字就不去)。
 * 空串 = 不改名(恢复默认)
 */
export function cleanName(kind: KeyKind, raw: string, eastern = false): string {
  // eslint-disable-next-line no-control-regex
  let s = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  const strip = (suffixes: readonly string[]) => {
    for (const x of suffixes) {
      if (s.endsWith(x) && s.length > x.length) {
        s = s.slice(0, s.length - x.length).trim();
        return;
      }
    }
  };
  if (kind === 'polity' || (kind === 'dynasty' && eastern)) strip(POLITY_SUFFIXES);
  else if (kind === 'dynasty') strip(['王朝']);
  else if (kind === 'culture') strip(['族']);
  const cs = [...s];
  return cs.length > NAME_MAX ? cs.slice(0, NAME_MAX).join('') : s;
}

/** 国名词根换成 root(东方国家的第一朝国号跟着换) */
function withRoot(p: Polity, root: string): Polity {
  const q: Polity = { ...p, name: root };
  const d = p.dynasties;
  if (p.eastern && d && d.length && d[0].name === p.name) q.dynasties = d.map((x, i) => (i === 0 ? { ...x, name: root } : x));
  return q;
}

/** 改名以后,复国的国家跟着故国变的新国名;不用变 = null */
function restoredName(p: Polity, fallenOld: Polity, fallenNew: Polity): string | null {
  const oldRoot = polityRootAt(fallenOld, fallenOld.ended ?? Infinity);
  const newRoot = polityRootAt(fallenNew, fallenNew.ended ?? Infinity);
  if (oldRoot === newRoot) return null;
  const base = p.eastern ? bare(oldRoot) : oldRoot;
  if (p.name.length !== base.length + 1 || !p.name.endsWith(base) || !RESTORE_PREFIXES.includes(p.name[0])) return null;
  return p.name[0] + (p.eastern ? bare(newRoot) : newRoot);
}

/**
 * 套上改名:返回一个新的 Civ(原 Civ 不改),名字换成用户起的;键找不到的、名字为空的忽略。
 * 新 Civ 和原 Civ 共用没改过的一切(地块、州、日志、没改名的国家 / 城……),只复制改了名的那几个对象。
 * 一个名字都没生效时直接返回原 Civ
 */
export function applyNames(civ: Civ, names: Record<string, string>): Civ {
  const polityRoot = new Map<number, string>();
  const dynasty = new Map<number, Map<number, string>>();
  const settlement = new Map<number, string>();
  const place = new Map<number, string>();
  const culture = new Map<number, string>();
  const region = new Map<number, string>();
  const faith = new Map<number, string>();
  const person = new Map<number, string>();
  for (const key in names) {
    const name = names[key];
    if (typeof name !== 'string' || !name) continue;
    const r = resolveKey(civ, key);
    if (!r) continue;
    if (r.kind === 'polity') polityRoot.set(r.id, name);
    else if (r.kind === 'settlement') settlement.set(r.id, name);
    else if (r.kind === 'place') place.set(r.id, name);
    else if (r.kind === 'culture') culture.set(r.id, name);
    else if (r.kind === 'region') region.set(r.id, name);
    else if (r.kind === 'faith') faith.set(r.id, name);
    else if (r.kind === 'person') person.set(r.id, name);
    else {
      let m = dynasty.get(r.id);
      if (!m) dynasty.set(r.id, (m = new Map()));
      m.set(r.index!, name);
    }
  }
  if (!polityRoot.size && !dynasty.size && !settlement.size && !place.size && !culture.size && !region.size && !faith.size && !person.size) return civ;

  let changed = false;
  // 州名:另起一份 regionNames(civ.regions 不动,见文件头)
  let regionNames = civ.regionNames;
  if (region.size) {
    const base = civ.regionNames ?? civ.regions.name ?? [];
    const out = Array.from({ length: civ.regions.count }, (_, r) => base[r] ?? '');
    for (const [id, name] of region) out[id] = name;
    if (out.some((n, r) => n !== (base[r] ?? ''))) {
      regionNames = out;
      changed = true;
    }
  }
  // 民族
  let cultures = civ.cultures;
  if (culture.size) {
    cultures = cultures.slice();
    for (const [id, name] of culture) {
      if (cultures[id].name === name) continue;
      cultures[id] = { ...cultures[id], name };
      changed = true;
    }
  }
  // 地理实体:记下原来的名字(画风按它分大洋 / 海 / 海湾)
  let places = civ.places;
  if (place.size) {
    places = places.slice();
    for (const [id, name] of place) {
      const p = places[id];
      if (p.name === name) continue;
      places[id] = { ...p, name, defaultName: p.defaultName ?? p.name };
      changed = true;
    }
  }
  // 城:先改用户改过的,再按编号顺序让"同族重建、沿用旧名"的城跟着旧城变(重建的城编号总比旧城大)
  let settlements = civ.settlements;
  if (settlement.size) {
    const S0 = civ.settlements;
    const S: Settlement[] = S0.slice();
    for (const [id, name] of settlement) if (S[id].name !== name) S[id] = { ...S[id], name };
    for (const s of S0) {
      if (s.rebuilds === undefined || settlement.has(s.id)) continue;
      const old = S0[s.rebuilds];
      const now = S[s.rebuilds];
      if (old && now !== old && s.name === old.name && now.name !== s.name) S[s.id] = { ...s, name: now.name };
    }
    if (S.some((s, i) => s !== S0[i])) {
      settlements = S;
      changed = true;
    }
  }
  // 国家:国名词根、各朝名字;复国的国家跟着故国的国号变(故国编号总比它小,按编号顺序一趟就连带完)
  let polities = civ.polities;
  /** 东方国家 `dynasty:…/0` = 国名词根 */
  const eastFirst = (id: number): string | undefined => (civ.polities[id].eastern ? dynasty.get(id)?.get(0) : undefined);
  if (polityRoot.size || dynasty.size) {
    const P0 = civ.polities;
    const P: Polity[] = P0.slice();
    for (const p0 of P0) {
      const id = p0.id;
      let p = p0;
      const root = polityRoot.get(id) ?? eastFirst(id);
      if (root !== undefined && root !== p.name) p = withRoot(p, root);
      const ds = dynasty.get(id);
      if (ds && p.dynasties) {
        const from = p.dynasties;
        let list: typeof from | null = null;
        for (const [i, name] of ds) {
          if (i === 0 && p.eastern) continue; // 东方第一朝 = 国名词根,上面已经换过
          if (!from[i] || from[i].name === name) continue;
          list ??= from.slice();
          list[i] = { ...from[i], name };
        }
        if (list) p = { ...p, dynasties: list };
      }
      if (root === undefined && p0.restores !== undefined && P[p0.restores] !== P0[p0.restores]) {
        const n = restoredName(p, P0[p0.restores], P[p0.restores]);
        if (n) p = withRoot(p, n);
      }
      P[id] = p;
    }
    if (P.some((p, i) => p !== P0[i])) {
      polities = P;
      changed = true;
    }
  }
  // 信仰:民间信仰跟着改过名的民族变(族名 + 祖灵 / 旧神;用户单独改过的除外)
  let religion = civ.religion;
  if (religion && (faith.size || culture.size)) {
    const F0 = religion.faiths;
    const F = F0.map((f) => {
      const name = faith.get(f.id) ?? (f.kind === 'folk' && culture.has(f.culture ?? f.id) ? folkRenamed(civ, f, cultures) : null);
      return name && name !== f.name ? { ...f, name } : f;
    });
    if (F.some((f, i) => f !== F0[i])) {
      religion = { ...religion, faiths: F };
      changed = true;
    }
  }
  // 人物:换本名,生成时的名字留在 defaultName(稳定键按它算,见 personKey)
  let people = civ.people;
  if (person.size && people) {
    let list: Person[] | null = null;
    for (const [id, name] of person) {
      const x = people[id];
      if (!x || x.name === name) continue;
      list ??= people.slice();
      list[id] = { ...x, name, defaultName: x.defaultName ?? x.name };
    }
    if (list) {
      people = list;
      changed = true;
    }
  }
  if (!changed) return civ;
  const out: Civ = { ...civ, cultures, places, settlements, polities };
  if (people) out.people = people;
  if (regionNames) out.regionNames = regionNames;
  if (religion) out.religion = religion;
  return out;
}

/** 民族改了名以后它的民间信仰叫什么(原名 = 原族名 + 词尾;对不上就不跟着改) */
function folkRenamed(civ: Civ, f: Faith, cultures: readonly Culture[]): string | null {
  const id = f.culture ?? f.id;
  const old = civ.cultures[id]?.name;
  if (!old || !f.name.startsWith(old)) return null;
  return cultures[id].name + f.name.slice(old.length);
}

// ---------------------------------------------------------------------------
// 干预

/** 干预年份的上限(推演引擎能预约的最远时刻) */
export const INTERVENTION_YEAR_MAX = 65535;

const INTERVENTION_KINDS: readonly InterventionKind[] = ['protect', 'ally', 'declare', 'unity', 'cede', 'found', 'move', 'halt'];

/** 键的格式(新旧两种都认:`polity:c4567#0` / 旧的 `polity:r123#0`,见文件头"稳定键") */
export const isPolityKey = (k: unknown): k is string => typeof k === 'string' && /^polity:(r-?\d{1,7}|c\d{1,7})#\d{1,5}$/.test(k);
export const isRegionKey = (k: unknown): k is string => typeof k === 'string' && REGION_KEY.test(k);
export const isCityKey = (k: unknown): k is string => typeof k === 'string' && /^settlement:[rc]\d{1,7}#\d{1,5}$/.test(k);
/** 年份:取整、夹到 [0, INTERVENTION_YEAR_MAX];不是有限数 = null */
export const yearOf = (y: unknown): number | null =>
  typeof y === 'number' && Number.isFinite(y) ? Math.min(INTERVENTION_YEAR_MAX, Math.max(0, Math.floor(y))) : null;

/**
 * 清理一份干预列表(推演前、读档时用):种类不认识、键的格式不对、年份不是有限数、两国是同一国的丢掉;
 * 年份取整、夹到 [0, INTERVENTION_YEAR_MAX];until 不晚于 from 的当作没给;立国的国名按改名的规矩清理(空 = 不给);
 * 划州的 permanent 只认 true;多余的字段去掉。全都合格时返回原数组(同一个对象)
 */
export function cleanInterventions(list: readonly unknown[] | null | undefined): Intervention[] {
  if (!Array.isArray(list)) return [];
  const out: Intervention[] = [];
  let same = true;
  for (const x of list as unknown[]) {
    const v = cleanIntervention(x);
    if (v) out.push(v);
    if (v !== x) same = false;
  }
  return same ? (list as Intervention[]) : out;
}

/** 清理一条干预(规则同 cleanInterventions);不合格 = null;本来就合格的原样返回(同一个对象) */
export function cleanIntervention(x: unknown): Intervention | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const kind = o.kind as InterventionKind;
  const from = yearOf(o.from);
  if (!INTERVENTION_KINDS.includes(kind) || from === null) return null;
  const untilOf = () => {
    const until = o.until === undefined ? null : yearOf(o.until);
    return until !== null && until > from ? until : null;
  };
  let v: Intervention;
  if (kind === 'found') {
    if (!isRegionKey(o.region)) return null;
    const name = typeof o.name === 'string' ? cleanName('polity', o.name) : '';
    v = name ? { kind, region: o.region, from, name } : { kind, region: o.region, from };
  } else {
    if (!isPolityKey(o.a)) return null;
    const a = o.a;
    if (kind === 'unity') v = { kind, a, from };
    else if (kind === 'protect' || kind === 'halt') {
      const until = untilOf();
      v = until !== null ? { kind, a, from, until } : { kind, a, from };
    } else if (kind === 'cede') {
      if (!isRegionKey(o.region)) return null;
      v = o.permanent === true ? { kind, a, region: o.region, from, permanent: true } : { kind, a, region: o.region, from };
    } else if (kind === 'move') {
      if (!isCityKey(o.city)) return null;
      v = { kind, a, city: o.city, from };
    } else {
      if (!isPolityKey(o.b) || o.b === a) return null;
      if (kind === 'declare') v = { kind, a, b: o.b, from };
      else {
        const until = untilOf();
        v = until !== null ? { kind, a, b: o.b, from, until } : { kind, a, b: o.b, from };
      }
    }
  }
  const keys = Object.keys(o);
  const w = v as Record<string, unknown>;
  const clean = keys.length === Object.keys(v).length && keys.every((k) => o[k] === w[k]);
  return clean ? (x as Intervention) : v;
}

/** 两份干预列表是不是一样(逐条逐字段比) */
export function sameInterventions(a: readonly Intervention[], b: readonly Intervention[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((x, i) => JSON.stringify(x) === JSON.stringify(b[i]));
}

/** 这条干预牵涉的国家键(a;结盟 / 宣战还有 b;立国没有 —— 新国家的键要推演出来才知道) */
export function interventionKeys(v: Intervention): string[] {
  if (v.kind === 'found') return [];
  return v.kind === 'ally' || v.kind === 'declare' ? [v.a, v.b] : [v.a];
}

// ---------------------------------------------------------------------------
// 作者标记

/** 标记的名字最长几个字 */
export const MARK_TITLE_MAX = 40;
/** 标记的说明最长几个字 */
export const MARK_NOTE_MAX = 2000;
/** 一个标记最多圈几个州 */
export const MARK_REGIONS_MAX = 500;
/** 一个世界最多几个标记(读进来的多出来的丢掉;再多地图就卡了) */
export const MARKS_MAX = 2000;
/** 标记编号最大到几 */
export const MARK_ID_MAX = 1e9;
/** 一个世界里所有标记一共最多圈几个州(同一州圈几次算几次;再多画几个州的形状就太费了) */
export const MARK_REGIONS_TOTAL = 10000;

/** 这些标记一共圈了几个州(except = 不算这个编号的) */
export function markRegionTotal(marks: readonly AuthorMark[] | undefined, except = 0): number {
  let n = 0;
  for (const m of marks ?? []) if (m.id !== except) n += m.regions?.length ?? 0;
  return n;
}
/** 名字是空的(新建时没起名)就叫这个 */
export const MARK_TITLE_DEFAULT = '新标记';

/** 时间轴停在 year 这一年时地图上有没有这个标记(year 取整;[from, to] 两头都算) */
export function markShownAt(m: Pick<AuthorMark, 'from' | 'to'>, year: number): boolean {
  const y = Math.floor(year);
  return y >= m.from && (m.to === undefined || y <= m.to);
}

/** 新标记的编号:现有最大的 + 1 */
export function nextMarkId(marks: readonly AuthorMark[] | undefined): number {
  let n = 0;
  for (const m of marks ?? []) if (m.id > n) n = m.id;
  return freeMarkId(new Set((marks ?? []).map((m) => m.id)), n);
}

/** 新编号:现有最大的(max)+ 1;到了 MARK_ID_MAX 就用最小的没用过的。used = 已经用了的编号,新编号也加进去 */
export function freeMarkId(used: Set<number>, max: number): number {
  let id = max + 1;
  if (id > MARK_ID_MAX) for (id = 1; used.has(id); id++);
  used.add(id);
  return id;
}

/** 名字:去掉控制字符、首尾空白、连着的空白并成一个,超长截断 */
export function cleanMarkTitle(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  const cs = [...s];
  return cs.length > MARK_TITLE_MAX ? cs.slice(0, MARK_TITLE_MAX).join('') : s;
}

/** 说明:去掉换行以外的控制字符、首尾空白,超长截断 */
export function cleanMarkNote(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim();
  const cs = [...s];
  return cs.length > MARK_NOTE_MAX ? cs.slice(0, MARK_NOTE_MAX).join('').trimEnd() : s;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * 清理一个标记(规则见文件头"作者标记");不合格 = null(没有位置、年份不是数、编号不是正整数……);
 * 名字是空的叫 MARK_TITLE_DEFAULT。本来就合格的原样返回(同一个对象)
 */
export function cleanMark(x: unknown): AuthorMark | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const id = o.id;
  const from = yearOf(o.from);
  if (typeof id !== 'number' || !Number.isInteger(id) || id < 1 || id > MARK_ID_MAX || from === null) return null;
  const color: MarkTint = o.color === 'none' || MARK_COLORS.includes(o.color as MarkColor) ? (o.color as MarkTint) : MARK_COLORS[0];
  const size = MARK_SIZES.includes(o.size as MarkSizeSet) ? (o.size as MarkSizeSet) : null;
  const title = cleanMarkTitle(o.title) || MARK_TITLE_DEFAULT;
  const note = cleanMarkNote(o.note);
  const to0 = o.to === undefined ? null : yearOf(o.to);
  const to = to0 !== null && to0 >= from ? to0 : null;
  let regions: string[] | null = null;
  let at: [number, number] | null = null;
  if (Array.isArray(o.regions)) {
    const seen = new Set<string>();
    for (const k of o.regions) if (isRegionKey(k) && !seen.has(k) && seen.size < MARK_REGIONS_MAX) seen.add(k);
    if (seen.size) regions = [...seen];
  }
  if (!regions && Array.isArray(o.at) && o.at.length === 2 && o.at.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    const [ax, ay] = o.at as number[];
    at = [round1(ax - TERRAIN_W * Math.floor(ax / TERRAIN_W)) % TERRAIN_W, round1(Math.min(TERRAIN_H, Math.max(0, ay)))];
  }
  if (!regions && !at) return null;
  const m: AuthorMark = { id, title, color, from };
  if (size) m.size = size;
  if (note) m.note = note;
  if (to !== null) m.to = to;
  if (regions) m.regions = regions;
  else m.at = at!;
  // 本来就合格(字段一个不多一个不少、值都一样)的原样返回
  const keys = Object.keys(o);
  const w = m as unknown as Record<string, unknown>;
  const same = (a: unknown, b: unknown) => a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]));
  const clean = keys.length === Object.keys(m).length && keys.every((k) => same(o[k], w[k]));
  return clean ? (x as AuthorMark) : m;
}

/** 两个标记是不是一模一样(各字段比,不管字段的先后) */
export function sameMark(a: AuthorMark, b: AuthorMark): boolean {
  const list = (x?: readonly unknown[], y?: readonly unknown[]) => x === y || (!!x && !!y && x.length === y.length && x.every((v, i) => v === y[i]));
  return a.id === b.id && a.title === b.title && a.note === b.note && a.color === b.color && a.size === b.size && a.from === b.from && a.to === b.to && list(a.at, b.at) && list(a.regions, b.regions);
}

/**
 * 清理一份标记列表(读档、撤销时用):不合格的丢掉;编号和前面重复的换成新编号(现有最大的 + 1)。
 * 全都合格时返回原数组(同一个对象)
 */
export function cleanMarks(list: readonly unknown[] | null | undefined): AuthorMark[] {
  if (!Array.isArray(list)) return [];
  const out: AuthorMark[] = [];
  let same = true;
  const ids = new Set<number>();
  const used = new Set<number>();
  let max = 0;
  for (const x of list as unknown[]) {
    const m = cleanMark(x);
    if (!m) continue;
    used.add(m.id);
    if (m.id > max) max = m.id;
  }
  let regions = 0;
  for (const x of list as unknown[]) {
    let m = out.length < MARKS_MAX ? cleanMark(x) : null;
    if (m?.regions && regions + m.regions.length > MARK_REGIONS_TOTAL) m = null;
    if (!m) {
      same = false;
      continue;
    }
    regions += m.regions?.length ?? 0;
    if (ids.has(m.id)) {
      m = { ...m, id: freeMarkId(used, max) };
      max = Math.max(max, m.id);
    }
    ids.add(m.id);
    if (m !== x) same = false;
    out.push(m);
  }
  return same ? (list as AuthorMark[]) : out;
}
