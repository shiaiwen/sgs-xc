/** 大厅等非牌桌场景下，「全局背景」应替换官方 BackgroundLayer.bg，而不是牌桌 sprite。 */
export function prefersGlobalBackgroundPresentation(allPaper: boolean, hasGameScene: boolean): boolean {
  return allPaper && !hasGameScene;
}
