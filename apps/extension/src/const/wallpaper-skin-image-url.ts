/** 皮肤背景列表图与设背景大图 URL 约定（官方 general/big 目录）。
 *
 * 对照逆向与资源实勘：
 * - `/big/static/` = 「全图」局内壁纸横图（约 16:9），不是列表专用小图
 * - `/big/bigSkin/` = 「高清」皮肤图
 * - 列表 IconURL 应对齐原生 SkinBigUrl（bigSkin）
 *   旧逻辑把 bigSkin→static 塞进列表格，裁切后会出现蓝/棕等纯色块
 */

const BIG_SKIN_DIR = '/big/bigSkin/';
const STATIC_DIR = '/big/static/';

/** 列表项图：static 全图改为 bigSkin；已是 bigSkin 则原样。 */
export function toWallpaperListThumbUrl(url: string): string {
  const value = String(url || '').trim();
  if (!value) return value;
  if (value.includes(STATIC_DIR)) return value.split(STATIC_DIR).join(BIG_SKIN_DIR);
  return value;
}

/** 设背景用全图地址。高清图地址经常打不开，换成全图。 */
export function toWallpaperApplyImageUrl(url: string): string {
  const value = String(url || '').trim();
  if (value.includes(BIG_SKIN_DIR)) return value.split(BIG_SKIN_DIR).join(STATIC_DIR);
  return value;
}

export function isWallpaperBigSkinUrl(url: string): boolean {
  return String(url || '').includes(BIG_SKIN_DIR);
}

export function isWallpaperStaticFullUrl(url: string): boolean {
  return String(url || '').includes(STATIC_DIR);
}
