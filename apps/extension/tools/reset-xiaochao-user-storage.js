/**
 * 小抄「一键清空本地数据」——在游戏页控制台粘贴整段运行。
 *
 * 用法：
 * 1. 打开三国杀网页并进入能加载小抄的页面（大厅或局内均可）。
 * 2. 按 F12 打开开发者工具，切到「控制台」。
 * 3. 打开本文件，全选复制，粘贴到控制台回车。
 * 4. 看到「小抄本地数据已清除，3 秒后刷新」后等待页面自动刷新。
 *
 * 微端与浏览器各存一份，在哪边玩就在哪边执行一次。
 * 不会删除游戏账号，只清小抄的配置、皮肤、自定义背景、记住的登录列表等。
 */
(function resetXiaochaoUserStorage() {
  const LEGACY_SUFFIXES = [
    '::paperRes',
    '::XC_SKIN_BACKGROUND_FAVORITES',
    '::XC_OFFICIAL_BACKGROUND_CHOICE',
    '::XC_GAME_GIFT_CODE_ATTEMPTS',
    '::XC_DAILY_AUTO_CLAIM_RECORD'
  ];
  const LEGACY_SWITCH_KEYS = [
    'XC::mainPanelActiveTab',
    'XC::mainPanelCollapsed',
    'XC::mainPanelDockedRight',
    'XC::mainPanelPosition',
    'DISCARD_SORT_MODE',
    'XC::handSortLockedMode',
    'XC::handSortPosition',
    'SEAT_UI_SWITCH',
    'DECK_RECORD_SWITCH',
    'CARD_LABEL_SWITCH',
    'COUNT_DOWN_SWITCH',
    'onlyNoPasswordRoomSwitch',
    'HAND_SORT_SWITCH',
    'SKIP_AD_WINDOW_SWITCH',
    'SKIP_MVP_WINDOW_SWITCH',
    'SKIP_PACKAGE_WINDOW_SWITCH',
    'SKIP_NOTICE_WINDOW_SWITCH',
    'SKIP_LAOXIAN_WINDOW_SWITCH',
    'SKIP_PROB_WINDOW_SWITCH',
    'BLOCK_SHA_EFFECT_SWITCH',
    'XC_AUTO_BOT_TAVERN_TARGET'
  ];
  const CREDENTIAL_KEYS = [
    'sgsol.rememberedCredentials.v2',
    'sgsol.rememberedCredentials.v2.4399'
  ];
  const SESSION_PREFIXES = [
    'XC',
    'XC::knownHands',
    '__XIAOCHAO_CHOOSE_FIGURE_LOCK__'
  ];

  function isXiaochaoKey(key) {
    if (!key) return false;
    if (key.startsWith('XC::') || key.startsWith('sgsol.') || key.startsWith('XC_')) return true;
    if (key.includes('::XC::')) return true;
    if (LEGACY_SWITCH_KEYS.includes(key)) return true;
    for (const suffix of LEGACY_SUFFIXES) {
      if (key.endsWith(suffix)) return true;
    }
    return false;
  }

  function isSessionKey(key) {
    if (!key) return false;
    const lower = key.toLowerCase();
    if (lower.includes('xiaochao')) return true;
    for (const prefix of SESSION_PREFIXES) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }

  function removeKey(key) {
    try {
      window.xiaochaoStorage?.registerKeys?.([key]);
    } catch (_) { /* 忽略 */ }
    try {
      window.xiaochaoStorage?.removeItem?.(key);
    } catch (_) { /* 忽略 */ }
    try {
      localStorage.removeItem(key);
    } catch (_) { /* 忽略 */ }
  }

  const keys = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key && isXiaochaoKey(key)) keys.push(key);
  }
  keys.forEach(removeKey);
  CREDENTIAL_KEYS.forEach((key) => {
    removeKey(key);
    const scope = key.endsWith('.4399') ? '4399' : 'official';
    try {
      window.xiaochaoStorage?.saveCredentials?.(scope, []);
    } catch (_) { /* 忽略 */ }
  });

  try {
    Object.keys(sessionStorage).filter(isSessionKey).forEach((key) => sessionStorage.removeItem(key));
  } catch (_) { /* 忽略 */ }

  const dbName = 'xiaochao-custom-background';
  const openRequest = indexedDB.open(dbName);
  openRequest.onsuccess = function onDbOpen() {
    const db = openRequest.result;
    const storeName = 'background';
    if (!db.objectStoreNames.contains(storeName)) {
      finish();
      return;
    }
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const getAllKeys = store.getAllKeys ? store.getAllKeys() : null;
    if (!getAllKeys) {
      finish();
      return;
    }
    getAllKeys.onsuccess = function onKeys() {
      const idbKeys = getAllKeys.result || [];
      const bridge = window.xiaochaoStorage?.customBackground;
      let pending = idbKeys.length;
      if (!pending) {
        finish();
        return;
      }
      idbKeys.forEach((idbKey) => {
        const accountKey = String(idbKey);
        const done = () => {
          try {
            store.delete(idbKey);
          } catch (_) { /* 忽略 */ }
          pending -= 1;
          if (pending <= 0) finish();
        };
        if (bridge && accountKey.startsWith('account:')) {
          Promise.resolve(bridge({ action: 'remove', accountKey }))
            .then(done)
            .catch(done);
        } else {
          done();
        }
      });
    };
    getAllKeys.onerror = finish;
  };
  openRequest.onerror = finish;

  function finish() {
    console.log('[小抄] 已清除', keys.length, '个本地配置键、会话缓存与自定义背景。3 秒后刷新页面。');
    setTimeout(() => window.location.reload(), 3000);
  }
})();
