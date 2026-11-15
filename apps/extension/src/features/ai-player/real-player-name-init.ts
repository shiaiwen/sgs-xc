/**
 * 用游戏名字层自己的方法画真人的等级和昵称。
 * 游戏只在部分模式初始化名字层时建名字底和两行字，其他模式在这里补建，再交给游戏按座位资料写字、排位置。
 * 调用方负责只对真人调用。人机不画，靠关掉名字层和真人区分。
 */

type UnknownRecord = Record<string, unknown>;

const NAME_REQUESTED_KEY = '__xcPlayNameRequested';

/** 游戏已经把这名真人的昵称写进名字层时返回 true。昵称还没到、或这一类名字层不画名字时返回 false。 */
export function drawRealPlayerName(manager: UnknownRecord, playerInfo: UnknownRecord): boolean {
  const showName = readGameShowName(playerInfo);
  if (!showName.trim()) return false;
  if (!readGameNameLabel(manager)) {
    delete manager[NAME_REQUESTED_KEY];
    callMethod(manager, 'createPlayerNameBg');
    callMethod(manager, 'createPlayerName');
  }
  const label = readGameNameLabel(manager);
  if (!label) return false;
  // 同一个昵称只请游戏写一次。有的名字层写字方法是空的，不要每轮都让它重新排版。
  if (readLabelText(label) !== showName && manager[NAME_REQUESTED_KEY] !== showName) {
    manager[NAME_REQUESTED_KEY] = showName;
    callMethod(manager, 'UpdatePlayerName', playerInfo);
    // 补建的字要等游戏排版才会挪到名字底上，等级位数变了昵称也要跟着挪。
    callMethod(manager, 'invalidateDisplayList');
  }
  return readLabelText(label) === showName;
}

/** 排查用：上次请游戏写进这层名字的昵称。 */
export function readRequestedShowName(manager: UnknownRecord): unknown {
  return manager[NAME_REQUESTED_KEY];
}

export function readGameNameLabel(manager: UnknownRecord): UnknownRecord | null {
  const label = manager.playerNameTxt;
  return label !== null && typeof label === 'object' ? label as UnknownRecord : null;
}

/** 游戏写名字时读的就是这个字段。 */
export function readGameShowName(playerInfo: UnknownRecord): string {
  try {
    const value = playerInfo.ShowName;
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

function readLabelText(label: UnknownRecord): string {
  return String(label.text ?? '');
}

function callMethod(manager: UnknownRecord, name: string, ...args: unknown[]): void {
  const method = manager[name];
  if (typeof method !== 'function') return;
  try {
    method.apply(manager, args);
  } catch {
    // 游戏这一步没做完时保持原样，下一轮扫描再试。
  }
}
