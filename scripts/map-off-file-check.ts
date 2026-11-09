/**
 * 以别的世界为底稿新建、本机没装它用的地图插件时,说明块里「从文件装…」直接弹出选文件的框(真浏览器走一遍):
 *   装环形山建世界 → 在插件页删掉 → 刷新再打开 → 世界设定「以它为底稿新建…」→ 说明块「从文件装…」
 *   取消选文件       什么都不变
 *   选了坏文件       出错说明,关掉以后说明块还在
 *   选了别的插件     说一句「不是这张地图用的」,没装,看完说明块还在
 *   选了第 1.1 版    装上以后说明块换成「你装的是第 1.1 版」
 *   选了第 1.0 版    换回同一版:权限框装上,说明块收起,编辑地形能放开
 *
 *   npx tsx scripts/map-off-file-check.ts <放插件文件的文件夹> [--phone] [--shot=某文件夹]
 * 文件夹里要有 craters.civplugin、craters11.civplugin(第 1.1 版)、tides.civplugin、bad.civplugin(不是插件的文件)。
 * 自动起一个临时 dev server。
 */
import { readFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import { startDevServer } from './lib/devserver';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
if (!dir) throw new Error('用法:npx tsx scripts/map-off-file-check.ts <放插件文件的文件夹> [--phone] [--shot=文件夹]');
const phone = args.includes('--phone');
const shot = args.find((a) => a.startsWith('--shot='))?.slice(7);
const file = (n: string) => `${dir}/${n}.civplugin`;

let failed = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? '通过' : '不对'}  ${what}`);
  if (!ok) failed++;
};

const dev = await startDevServer();
const browser = await chromium.launch();
// 手机:建世界、删插件、以它为底稿新建照电脑的画面走,说明块出来以后再换成手机的尺寸
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: phone ? 2 : 1 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

const note = (p: Page) => p.locator('[data-testid=map-off]');
const snap = async (name: string) => {
  if (shot) await page.screenshot({ path: `${shot}/${name}.png` });
};
/** 点说明块里的「从文件装…」,选 f(null = 取消选文件) */
async function pickFile(f: string | null) {
  const chooser = page.waitForEvent('filechooser');
  await note(page).locator('[data-act=map-off-file]').click();
  const c = await chooser;
  await c.setFiles(f ? file(f) : []);
  await page.waitForTimeout(f ? 1500 : 500);
}
const click = (act: string) => page.locator(`[data-act=${act}]`).first().click();

try {
  await page.goto(`${dev.url}/?plugins=on`);
  await page.waitForTimeout(4000);
  const bytes = [...readFileSync(file('craters'))];
  await page.evaluate(async (arr) => {
    const m = await import(/* @vite-ignore */ String('/src/plugin/pluginStore.ts'));
    await m.installPlugin(new File([new Uint8Array(arr)], 'craters.civplugin'), {});
  }, bytes);

  // 装着环形山建一个世界
  await click('new-world');
  await click('dlg-next');
  await page.waitForTimeout(2000);
  await click('dlg-start');
  await page.waitForTimeout(8000);
  await click('map-plugins');
  await click('map-add');
  await page.waitForTimeout(500);
  await click('map-pick-back');
  await page.waitForTimeout(8000);
  await click('save-map');
  await page.waitForTimeout(5000);
  await click('map-new-civ');
  await page.waitForTimeout(8000);
  await click('create-world');
  await page.waitForTimeout(5000);
  await click('confirm-create');
  await page.waitForTimeout(20000);

  // 在插件页删掉它,刷新再打开
  await click('world-more');
  await click('plugins');
  await page.waitForTimeout(1500);
  await click('plugin-remove');
  await page.waitForTimeout(1000);
  await page.keyboard.press('Escape');
  await page.reload();
  await page.waitForTimeout(6000);

  // 以它为底稿新建
  await click('genesis');
  await page.waitForTimeout(1500);
  await click('draft-from');
  await note(page).first().waitFor({ timeout: 30000 });
  if (phone) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1500);
    await click('new-sheet');
  }
  await page.waitForTimeout(1500);
  check((await note(page).count()) === 1, '没装:新建界面有说明块');
  await snap('1-没装');

  // 取消选文件:什么都不变
  await pickFile(null);
  check((await note(page).count()) === 1 && (await page.locator('.plg-bg').count()) === 0, '取消选文件:说明块还在,没弹插件页');

  // 坏文件
  await pickFile('bad');
  check((await page.locator('[data-said=broken]').count()) === 1, '选了坏文件:出错说明');
  await click('plugin-ok');
  await page.waitForTimeout(500);
  check((await page.locator('.plg-bg').count()) === 0 && (await note(page).count()) === 1, '看完出错说明:插件页关了,说明块还在');

  // 别的插件:说一句、不装
  const tidesWas = await page.evaluate(async () => (await (await import(/* @vite-ignore */ String('/src/plugin/pluginStore.ts'))).listPlugins()).length);
  await pickFile('tides');
  check((await page.locator('[data-act=plugin-ok]').count()) === 1 && (await page.locator('[data-said=other]').count()) === 1, '选了别的插件:出一句话、没有权限框');
  check((await page.locator('[data-testid=plugin-said]').innerText()).includes('不是这张地图用的「环形山」'), '这句话说了文件是哪个、地图要哪个');
  await snap('0-别的插件');
  await click('plugin-ok');
  await page.waitForTimeout(500);
  check((await page.locator('.plg-bg').count()) === 0 && (await note(page).count()) === 1, '看完这句话:插件页关了,说明块还在');
  const tidesNow = await page.evaluate(async () => (await (await import(/* @vite-ignore */ String('/src/plugin/pluginStore.ts'))).listPlugins()).length);
  check(tidesNow === tidesWas, '选了别的插件:没装上');

  // 第 1.1 版:装上,说明块变成版本不对
  await pickFile('craters11');
  await click('plugin-ok');
  await page.waitForTimeout(4000);
  check((await page.locator('.plg-bg').count()) === 0, '装上第 1.1 版:插件页关了');
  check((await note(page).locator('[data-act=map-off-swap]').count()) === 1, '装了别的版本:说明块换成「换成第 1.1 版重新长」');
  await snap('2-版本不对');

  // 回到同一版:装上,说明块收起
  await page.evaluate(async () => {
    const m = await import(/* @vite-ignore */ String('/src/plugin/pluginStore.ts'));
    await m.removePlugin('craters');
    await (await import(/* @vite-ignore */ String('/src/ui/plugins/mapWorld.ts'))).refreshMapNow();
  });
  await page.waitForTimeout(2500);
  check((await note(page).locator('[data-act=map-off-file]').count()) === 1, '删了以后又是没装的说明块');
  await pickFile('craters');
  await click('plugin-ok');
  await page.waitForTimeout(5000);
  check((await note(page).count()) === 0, '装回同一版:说明块收起');
  check((await page.locator('.plg-bg').count()) === 0, '装回同一版:插件页关了');
  await snap('3-装好收起');
  await click('terrain');
  await page.waitForTimeout(1500);
  check((await note(page).count()) === 0, '编辑地形:没有说明块');
  await snap('4-编辑地形');
} finally {
  await browser.close();
  await dev.close();
}
if (failed) {
  console.log(`${failed} 项不对`);
  process.exit(1);
}
console.log('全部通过');
