export interface FavoriteInUseInput {
  currentUrl: string | undefined;
  currentType: number | undefined;
  favoriteUrl: string;
  favoriteType: number | undefined;
  /** 设背景时从原图拉下来的临时地址，没有就传空。 */
  runtimeBlobUrl: string;
  /** 临时地址对应的原图地址。 */
  runtimeBlobSourceUrl: string;
}

/**
 * 判断某个收藏是不是正在使用的背景。
 * 设背景时画的是临时地址，不是收藏里存的原图地址，所以要借临时地址的来源去对。
 */
export function isFavoriteInUse(input: FavoriteInUseInput): boolean {
  if (Number(input.currentType) !== Number(input.favoriteType)) return false;
  if (!input.favoriteUrl) return false;
  if (input.currentUrl === input.favoriteUrl) return true;
  if (!input.runtimeBlobUrl || input.currentUrl !== input.runtimeBlobUrl) return false;
  return input.runtimeBlobSourceUrl === input.favoriteUrl;
}
