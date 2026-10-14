/**
 * 微端的键盘焦点桥。
 *
 * 游戏页面在 webview 里，也就是 Chromium 的 guest。点进页面里的输入框时，
 * 只有网页内的焦点进了 guest，操作系统层面的键盘焦点还留在外层页面，
 * 输入法的组合过程因此到不了 guest：数字字母这类直接按键能发出去，
 * 中文打字发不出去。把窗口最大化再还原会让系统焦点回到 guest，所以看着像
 * 「点一下就好了」。
 *
 * 这里在游戏页里盯着输入框聚焦，交给外壳把系统焦点还给 webview。
 * 非微端环境没有 electron 对象，函数直接空转。
 */

type FocusBridgeWindow = Window & {
  electron?: { focusWebview?: () => void };
};

/** 这类元素才需要中文输入法，画布和普通 div 不用管。 */
function needsKeyboardFocus(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== 'string') return false;
  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') return true;
  return element.isContentEditable === true;
}

/**
 * 安装焦点桥；返回 dispose。
 * 除了聚焦，输入框上再按一次鼠标也算：焦点没变时不会触发 focusin。
 */
export function installMicroClientFocusBridge(globalObject: FocusBridgeWindow = window as FocusBridgeWindow): () => void {
  const electron = globalObject.electron;
  if (!electron || typeof electron.focusWebview !== 'function') return () => {};
  const bridge = electron.focusWebview.bind(electron);
  const document = globalObject.document;
  const handFocusBack = (event: Event): void => {
    if (!needsKeyboardFocus(event.target)) return;
    try {
      bridge();
    } catch {
      // 外壳没接住时不影响打字。
    }
  };
  document.addEventListener('focusin', handFocusBack, true);
  document.addEventListener('pointerdown', handFocusBack, true);
  return () => {
    document.removeEventListener('focusin', handFocusBack, true);
    document.removeEventListener('pointerdown', handFocusBack, true);
  };
}
