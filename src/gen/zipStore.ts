/**
 * 不压缩的 ZIP:把几块字节装成一个文件,任何解压软件都打得开。里面的块自己压缩过,外壳再压没好处,所以只用「不压缩」(stored)。
 *
 * 写(writeZip):用 Blob 拼接,块的字节不复制进一整块内存;块本身是 Blob 的,算校验时也是一段段读。
 * 文件名一律 UTF-8。时间固定,同样的内容打出同样的字节(什么时候存的不归外壳记)。
 *
 * 读(readZip、parseZip):文件当成坏的看,只认最规矩的那种长法,别的一律抛 Error:
 * - 大小(调用方按用途传:传上服务器 ZIP_UPLOAD_MAX_BYTES,本机存取 ZIP_LOCAL_MAX_BYTES)、条目数有上限;末尾必须正好是目录的结尾(不接受压缩包注释、尾巴上多的字节)
 * - 各条目必须从头到目录首尾相接、不留空、不重叠。先核对这条再算校验:不然几千个条目指同一段字节,光算校验就算不完
 * - 目录和各条目自己的头要说同样的话(两边不一样,不同的软件会读出不同的内容)
 * - 拒绝加密、分卷、ZIP64(世界用不到 4 GB)、除「不压缩」以外的压缩方式、声明大小对不上、校验(CRC-32)对不上
 * - 文件名:拒绝 ..、绝对路径、反斜杠、盘符、控制字符、目录条目、每一段结尾的点和空格、重复的(只差大小写、只差 Unicode 写法的
 *   也算重复:Windows、Mac 上解压到同一个文件)、既当文件又当目录的;不是 UTF-8 的拒绝
 *
 * 读一个可能很大、可能不完整的包(walkZip):「全部存成文件」存的那种,里面每个世界自己有校验。从头按条目走,不读进内存、不要求目录还在:
 * 下载到一半断了、中间坏了一段,走到哪算哪,前面完整的条目照样拿得到。
 *
 * 纯计算,不碰 DOM:Blob 在 worker、Node 里都有。
 */

/** 传上服务器的文件最大多少字节 */
export const ZIP_UPLOAD_MAX_BYTES = 64e6;
/**
 * 本机存成文件、打开文件最大多少字节。本机的世界不设额度,这个数只防撑爆内存(打开别人的文件时大小都是别人说了算):
 * 读文件要整个读进内存,再大手机上就读不动了;量到的最大的世界(20 万地块、6 万年、5 件地形大事、陆地 95%)约 140 MB,这个数大它七倍,插件的附加数据也放得下
 */
export const ZIP_LOCAL_MAX_BYTES = 1e9;
/** 不用 ZIP64,偏移和大小都是 32 位:传多大的上限也不能超过它 */
const ZIP32_MAX_BYTES = 0xfffffffe;
/** 最多几个条目:一个世界连同以后的扩展内容也就几十块,留足余量;只防条目数把目录撑得很大 */
export const ZIP_MAX_ENTRIES = 4096;
/** 文件名最多多少字节(连路径):世界文件里最长的也就几十字节;Windows 上路径最长也才 260 个字符 */
const NAME_MAX_BYTES = 255;

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const LOCAL_SIZE = 30;
const CENTRAL_SIZE = 46;
const END_SIZE = 22;
/** 标记位:文件名是 UTF-8 */
const FLAG_UTF8 = 0x0800;
/** 标记位:三种加密(普通、强加密、连目录一起加密) */
const FLAG_ENCRYPTED = 0x0001 | 0x0040 | 0x2000;
/** 打开要 ZIP 1.0 的能力(不压缩) */
const VERSION = 10;
/** 固定的时间 1980-02-01 00:00(ZIP 的时间从 1980 年算;1 月 1 日换时区会算到 1980 年以前,有的软件报错) */
const DOS_DATE = (2 << 5) | 1;
/** 额外字段里 ZIP64 的编号 */
const EXTRA_ZIP64 = 0x0001;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

/** CRC-32;分段算时把上一段的结果传进 crc */
export function crc32(data: Uint8Array, crc = 0): number {
  let c = ~crc;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

/** 文件名合不合规矩(读写同一套:写得出来的就读得回来);不合规矩抛错 */
function checkName(name: string, nameBytes: number): void {
  if (nameBytes > NAME_MAX_BYTES) throw new Error('ZIP 里的文件名太长');
  // 反斜杠在 Windows 上是路径分隔符、冒号是盘符;\p{Cs} 是半个的代理字符(写不成 UTF-8)
  if (/[\u0000-\u001f\u007f\\:]|\p{Cs}/u.test(name)) throw new Error('ZIP 里的文件名有不许用的字符');
  // 开头、结尾的 / 和连着两个 / 都会切出空的一段(绝对路径、目录条目);
  // Windows 会去掉每一段结尾的点和空格:"a." 和 "a" 解压到同一个文件,".. " 等于上一层。这样的一段一律不要(. 和 .. 也算在里面)
  for (const seg of name.split('/')) if (!seg || /[. ]$/.test(seg)) throw new Error('ZIP 里的文件名路径不对');
}

/**
 * 查文件名撞不撞,先后不论:解压到不分大小写的磁盘上是同一个文件的不行;一个名字既当文件又当目录的(parts 和 parts/map.gz)也不行,
 * 解压时后一个放不下。文件名长度、条目数都有上限,一个文件查下来也就几十 MB 字符
 */
function nameChecker(): (name: string) => void {
  const files = new Set<string>();
  const dirs = new Set<string>();
  return (name) => {
    const key = name.normalize('NFC').toLowerCase();
    if (files.has(key) || dirs.has(key)) throw new Error(`ZIP 里的文件名撞了:${name}`);
    files.add(key);
    for (let i = key.indexOf('/'); i >= 0; i = key.indexOf('/', i + 1)) {
      const dir = key.slice(0, i);
      if (files.has(dir)) throw new Error(`ZIP 里的文件名撞了:${name}`);
      dirs.add(dir);
    }
  };
}

/** 要装进文件的一块 */
export interface ZipInput {
  /** 文件名(可以带 / 分目录) */
  name: string;
  data: Uint8Array | ArrayBuffer | Blob;
}

/** 文件里读出来的一块 */
export interface ZipEntry {
  name: string;
  /** 块的字节(和传进来的字节共用,不复制) */
  data: Uint8Array;
}

/** 一块字节的 CRC-32;Blob 是一段段读的,不一次读进内存 */
async function crcOf(data: Uint8Array | Blob): Promise<number> {
  if (!(data instanceof Blob)) return crc32(data);
  let crc = 0;
  const reader = (data.stream() as ReadableStream<Uint8Array>).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return crc;
    crc = crc32(value, crc);
  }
}

/** 调用方给的上限:不是数,或者超过 32 位 ZIP 放得下的,都算写错了 */
function checkMax(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > ZIP32_MAX_BYTES) throw new Error('ZIP 的大小上限不对');
}

/** 打成 ZIP(不压缩)。文件名不合规矩、重复,或者打出来超过 maxBytes、ZIP_MAX_ENTRIES(自己也读不回来)的抛错 */
export async function writeZip(entries: readonly ZipInput[], maxBytes: number): Promise<Blob> {
  checkMax(maxBytes);
  if (entries.length > ZIP_MAX_ENTRIES) throw new Error('ZIP 的条目太多');
  const enc = new TextEncoder();
  const noClash = nameChecker();
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let at = 0;
  let centralSize = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    checkName(e.name, name.length);
    noClash(e.name);
    const data = e.data instanceof ArrayBuffer ? new Uint8Array(e.data) : e.data;
    const size = data instanceof Blob ? data.size : data.byteLength;
    if (at + size > maxBytes) throw new Error('ZIP 太大');
    const crc = await crcOf(data);

    const local = new Uint8Array(LOCAL_SIZE + name.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, SIG_LOCAL, true);
    l.setUint16(4, VERSION, true);
    l.setUint16(6, FLAG_UTF8, true);
    l.setUint16(12, DOS_DATE, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, size, true);
    l.setUint32(22, size, true);
    l.setUint16(26, name.length, true);
    local.set(name, LOCAL_SIZE);

    const head = new Uint8Array(CENTRAL_SIZE + name.length);
    const c = new DataView(head.buffer);
    c.setUint32(0, SIG_CENTRAL, true);
    c.setUint16(4, VERSION, true);
    c.setUint16(6, VERSION, true);
    c.setUint16(8, FLAG_UTF8, true);
    c.setUint16(14, DOS_DATE, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, size, true);
    c.setUint32(24, size, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, at, true);
    head.set(name, CENTRAL_SIZE);

    parts.push(local, data);
    central.push(head);
    at += local.length + size;
    centralSize += head.length;
  }
  if (at + centralSize + END_SIZE > maxBytes) throw new Error('ZIP 太大');
  const end = new Uint8Array(END_SIZE);
  const v = new DataView(end.buffer);
  v.setUint32(0, SIG_END, true);
  v.setUint16(8, entries.length, true);
  v.setUint16(10, entries.length, true);
  v.setUint32(12, centralSize, true);
  v.setUint32(16, at, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}

/** 额外字段(编号 2 字节、长度 2 字节、内容)里有没有 ZIP64;本身长得不对也拒绝 */
function checkExtra(dv: DataView, from: number, to: number): void {
  let p = from;
  while (p < to) {
    if (p + 4 > to) throw new Error('ZIP 的额外字段不对');
    if (dv.getUint16(p, true) === EXTRA_ZIP64) throw new Error('不支持 ZIP64');
    p += 4 + dv.getUint16(p + 2, true);
  }
  if (p !== to) throw new Error('ZIP 的额外字段不对');
}

/** 一个条目的标记位:只认「文件名是 UTF-8」这一位 */
function checkFlags(flags: number): void {
  if (flags & FLAG_ENCRYPTED) throw new Error('不支持加密的 ZIP');
  if (flags & ~FLAG_UTF8) throw new Error('ZIP 的标记位认不出');
}

/** 从头走到的一个条目:data 是原文件的一段,用到才读 */
export interface ZipSlice {
  name: string;
  data: Blob;
}

/** 走完的结果。clean = 一路规规矩矩走到了目录;false = 中途断了、坏了(entries 里还是走到的那些) */
export interface ZipWalk {
  entries: ZipSlice[];
  clean: boolean;
}

/**
 * 从头按条目走一个 Blob(见文件头):每个条目只读头,字节留在文件里。不抛错,走不下去就停。
 * 这里不算 CRC:整个包可能比内存大,用的人读到哪一段再核对(世界文件自己有校验)
 */
export async function walkZip(file: Blob, maxEntries: number = ZIP_MAX_ENTRIES): Promise<ZipWalk> {
  const entries: ZipSlice[] = [];
  const dec = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const noClash = nameChecker();
  let at = 0;
  let clean = true;
  try {
    while (entries.length < maxEntries) {
      const head = new Uint8Array(await file.slice(at, at + LOCAL_SIZE).arrayBuffer());
      if (head.length < 4) return { entries, clean: false };
      const dv = new DataView(head.buffer);
      const sig = dv.getUint32(0, true);
      if (sig === SIG_CENTRAL) return { entries, clean };
      if (sig !== SIG_LOCAL || head.length < LOCAL_SIZE) return { entries, clean: false };
      const size = dv.getUint32(22, true);
      const nameLen = dv.getUint16(26, true);
      const dataAt = at + LOCAL_SIZE + nameLen + dv.getUint16(28, true);
      // 压缩、加密过的、大小写在后面的(标记位认不出):走不下去
      if (dv.getUint16(8, true) !== 0 || dv.getUint16(6, true) & ~FLAG_UTF8 || dv.getUint32(18, true) !== size || dataAt + size > file.size) return { entries, clean: false };
      try {
        const name = dec.decode(new Uint8Array(await file.slice(at + LOCAL_SIZE, at + LOCAL_SIZE + nameLen).arrayBuffer()));
        checkName(name, nameLen);
        noClash(name);
        entries.push({ name, data: file.slice(dataAt, dataAt + size) });
      } catch {
        // 这一条的名字不对:不要它,后面的接着走
        clean = false;
      }
      at = dataAt + size;
    }
    return { entries, clean: false };
  } catch {
    return { entries, clean: false };
  }
}

/** 读文件(Blob):大小先看,超上限的不读进内存;其余见 parseZip */
export async function readZip(file: Blob, maxBytes: number): Promise<ZipEntry[]> {
  checkMax(maxBytes);
  if (file.size > maxBytes) throw new Error('ZIP 太大');
  return parseZip(new Uint8Array(await file.arrayBuffer()), maxBytes);
}

/** 读内存里的字节:交回的各块和 bytes 共用字节;坏文件抛错(规矩见文件头) */
export function parseZip(bytes: Uint8Array, maxBytes: number): ZipEntry[] {
  checkMax(maxBytes);
  if (bytes.length > maxBytes) throw new Error('ZIP 太大');
  if (bytes.length < END_SIZE) throw new Error('ZIP 不完整');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o: number) => dv.getUint16(o, true);
  const u32 = (o: number) => dv.getUint32(o, true);

  const endAt = bytes.length - END_SIZE;
  if (u32(endAt) !== SIG_END) throw new Error('不是 ZIP,或者尾巴上有多的字节');
  const count = u16(endAt + 10);
  const centralSize = u32(endAt + 12);
  const centralAt = u32(endAt + 16);
  if (count === 0xffff || centralSize === 0xffffffff || centralAt === 0xffffffff) throw new Error('不支持 ZIP64');
  if (endAt >= 20 && u32(endAt - 20) === SIG_ZIP64_LOCATOR) throw new Error('不支持 ZIP64');
  if (u16(endAt + 4) || u16(endAt + 6) || u16(endAt + 8) !== count) throw new Error('不支持分卷的 ZIP');
  if (u16(endAt + 20)) throw new Error('ZIP 的注释不对');
  if (count > ZIP_MAX_ENTRIES) throw new Error('ZIP 的条目太多');
  if (centralAt + centralSize !== endAt) throw new Error('ZIP 的目录位置不对');

  const dec = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const noClash = nameChecker();
  const found: { name: string; at: number; dataAt: number; size: number; crc: number }[] = [];
  let p = centralAt;
  for (let i = 0; i < count; i++) {
    if (p + CENTRAL_SIZE > endAt || u32(p) !== SIG_CENTRAL) throw new Error('ZIP 的目录不完整');
    const flags = u16(p + 8);
    const method = u16(p + 10);
    const crc = u32(p + 16);
    const packed = u32(p + 20);
    const size = u32(p + 24);
    const nameLen = u16(p + 28);
    const extraLen = u16(p + 30);
    const commentLen = u16(p + 32);
    const disk = u16(p + 34);
    const at = u32(p + 42);
    const nameAt = p + CENTRAL_SIZE;
    const next = nameAt + nameLen + extraLen + commentLen;
    if (next > endAt) throw new Error('ZIP 的目录不完整');
    if (packed === 0xffffffff || size === 0xffffffff || at === 0xffffffff || disk === 0xffff) throw new Error('不支持 ZIP64');
    if (disk) throw new Error('不支持分卷的 ZIP');
    checkFlags(flags);
    if (method !== 0) throw new Error('只认不压缩的 ZIP');
    if (packed !== size) throw new Error('ZIP 里的大小对不上');
    checkExtra(dv, nameAt + nameLen, nameAt + nameLen + extraLen);

    const nameBytes = bytes.subarray(nameAt, nameAt + nameLen);
    if (!(flags & FLAG_UTF8) && nameBytes.some((b) => b >= 0x80)) throw new Error('ZIP 里的文件名不是 UTF-8');
    const name = dec.decode(nameBytes);
    checkName(name, nameLen);
    noClash(name);

    // 这个条目自己的头,要和目录说的一样
    if (at + LOCAL_SIZE > centralAt || u32(at) !== SIG_LOCAL) throw new Error('ZIP 的条目位置不对');
    const localExtra = u16(at + 28);
    const dataAt = at + LOCAL_SIZE + nameLen + localExtra;
    if (dataAt + size > centralAt) throw new Error('ZIP 的条目超出了文件');
    if (u16(at + 6) !== flags || u16(at + 8) !== method || u32(at + 14) !== crc || u32(at + 18) !== packed || u32(at + 22) !== size || u16(at + 26) !== nameLen) throw new Error('ZIP 的目录和条目对不上');
    for (let k = 0; k < nameLen; k++) if (bytes[at + LOCAL_SIZE + k] !== nameBytes[k]) throw new Error('ZIP 的目录和条目对不上');
    checkExtra(dv, at + LOCAL_SIZE + nameLen, dataAt);

    found.push({ name, at, dataAt, size, crc });
    p = next;
  }
  if (p !== endAt) throw new Error('ZIP 的目录大小对不上');

  // 各条目从头到目录首尾相接(见文件头);对上了才算校验,总共只算一遍文件那么多字节
  const sorted = found.slice().sort((a, b) => a.at - b.at);
  let cursor = 0;
  for (const e of sorted) {
    if (e.at !== cursor) throw new Error('ZIP 的条目之间有空隙或重叠');
    cursor = e.dataAt + e.size;
  }
  if (cursor !== centralAt) throw new Error('ZIP 的条目之间有空隙或重叠');
  return found.map((e) => {
    const data = bytes.subarray(e.dataAt, e.dataAt + e.size);
    if (crc32(data) !== e.crc) throw new Error(`ZIP 里 ${e.name} 对不上校验`);
    return { name: e.name, data };
  });
}
