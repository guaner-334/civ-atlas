/** 我的世界标题下那句(登录了、服务器开了传到账号的)。字数量过,手机上窄。 */
export function homeAccountLine(n: number, uploaded: number, phone: boolean): string {
  if (!n) return '建好的世界存在这个浏览器里。到「存档」里传到账号，换设备也能打开。';
  if (phone) return uploaded ? `${n} 个世界，${uploaded} 个传到了账号` : `${n} 个世界，都在这个浏览器里`;
  return uploaded ? `${n} 个世界存在这个浏览器里，传到账号的 ${uploaded} 个换设备也能打开。` : `${n} 个世界存在这个浏览器里。想换设备打开，到「存档」里传到账号。`;
}
