/**
 * 侧栏「这颗星球」、世界设定的「地图」页上的两个动作:「在这张地图上打造新文明」(进新建界面的「打造文明」,见 App 的 startNewCiv)、
 * 打开同一张地图上的另一个文明。App 挂上真正做事的那一步,别的组件只管调。纯转手,不碰 DOM。
 */
let handler: ((id: string) => void) | null = null;

export function setNewCivHandler(f: ((id: string) => void) | null): void {
  handler = f;
}

/** 在 id 这个世界(或只存了地图的那一份)的地图上打造新文明 */
export function startNewCiv(id: string): void {
  handler?.(id);
}

/** 打开「我的世界」里的一个世界(世界设定「地图」页里点同一张地图上的另一个文明):App 挂上 */
let opener: ((id: string) => void) | null = null;

export function setOpenWorldHandler(f: ((id: string) => void) | null): void {
  opener = f;
}

export function openWorldById(id: string): void {
  opener?.(id);
}
