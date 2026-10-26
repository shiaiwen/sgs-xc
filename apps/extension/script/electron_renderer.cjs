/**
 * 微端 preload：在游戏页（webview guest）里暴露小抄桥接 API。
 *
 * 职责：
 * - 标记 WEIDUAN，供页面识别微端环境
 * - 暴露 window.electron（开窗、外链、IPC、焦点回交等）
 * - 暴露 window.xiaochaoStorage：把白名单设置项与凭证同步到主进程共享存储，
 *   多开/多窗口之间共用同一份配置，避免各 guest 各写一份 localStorage
 *
 * 注意：本文件跑在 guest 的 preload 上下文；焦点相关请配合 electron_frame.cjs
 * 里对 xiaochao-focus-webview 的处理，否则中文输入法会打不进游戏页。
 */
const { ipcRenderer, contextBridge } = require('electron');

/** 向主进程查询本机 Steam ID（非 Steam 包一般为空）。 */
async function GetSteamId(){
    const steamId =  await ipcRenderer.invoke('get-steam-id');
    console.log('你的 Steam ID 是:', steamId);
    return steamId;
}

var isSteam = false;

/** 已登记为「跨窗口共享」的 localStorage key 集合。 */
const sharedSettingKeys = new Set();
const nativeLocalStorage = window.localStorage;

/**
 * 同步 IPC 封装。共享存储不可用时降级返回 null，调用方继续用本地 localStorage。
 */
function sendSharedSync(channel, data) {
    try {
        return ipcRenderer.sendSync(channel, data);
    } catch (error) {
        console.warn('shared micro-client storage unavailable:', channel, error);
        return null;
    }
}

/**
 * 跨窗口共享存储：
 * - registerKeys：登记 key，并把本地已有值上报；主进程回灌合并后的权威值
 * - get/set/remove：已登记 key 走主进程同步，未登记仍写本页 localStorage
 * - get/saveCredentials：账号密码列表按 scope（如 official / 4399）共享
 */
const xiaochaoStorage = {
    registerKeys: (keys) => {
        const normalizedKeys = Array.isArray(keys) ? keys.map(String).filter(Boolean) : [];
        const localValues = {};
        normalizedKeys.forEach((key) => {
            sharedSettingKeys.add(key);
            const value = nativeLocalStorage.getItem(key);
            if (value !== null) localValues[key] = value;
        });
        const sharedValues = sendSharedSync('xiaochao-settings-register-sync', {
            keys: normalizedKeys,
            localValues
        });
        if (sharedValues && typeof sharedValues === 'object') {
            Object.entries(sharedValues).forEach(([key, value]) => {
                nativeLocalStorage.setItem(key, String(value));
            });
        }
        return sharedValues || {};
    },
    getItem: (key) => {
        key = String(key);
        if (!sharedSettingKeys.has(key)) return nativeLocalStorage.getItem(key);
        const result = sendSharedSync('xiaochao-setting-get-sync', key);
        if (result && result.found) {
            nativeLocalStorage.setItem(key, String(result.value));
            return String(result.value);
        }
        return nativeLocalStorage.getItem(key);
    },
    setItem: (key, value) => {
        key = String(key);
        value = String(value);
        nativeLocalStorage.setItem(key, value);
        if (sharedSettingKeys.has(key)) {
            sendSharedSync('xiaochao-setting-set-sync', { key, value });
        }
    },
    removeItem: (key) => {
        key = String(key);
        nativeLocalStorage.removeItem(key);
        if (sharedSettingKeys.has(key)) sendSharedSync('xiaochao-setting-delete-sync', key);
    },
    getCredentials: (scope, localCredentials) => {
        return sendSharedSync('xiaochao-credentials-get-sync', { scope, localCredentials }) || localCredentials || [];
    },
    saveCredentials: (scope, credentials) => {
        return sendSharedSync('xiaochao-credentials-set-sync', { scope, credentials });
    }
};

/** 注入到页面的 electron 桥：开窗、外链、通用 invoke、输入框焦点回交。 */
const api = {
    WDVerSion: "1.0.0",
    isSteam: isSteam,
    GetSteamId: GetSteamId,
    hasOpenHandler: () => {
        return ipcRenderer.invoke('has-open-handler').catch(() => false);
    },
    openWindow: (url) => {
        return ipcRenderer.invoke('open-window', url).catch(() => false);
    },
    openExternal: (url) => {
        return ipcRenderer.invoke('open-external', url).catch(() => false);
    },
    invoke: (channel, data) => {
        return ipcRenderer.invoke(channel, data);
    },
    // 输入框拿到焦点时调用：请外层把原生键盘焦点和输入法状态交给 webview。
    // guest 的键盘焦点会和外层脱钩，中文输入法因此打不进游戏页面。
    focusWebview: () => {
        try {
            ipcRenderer.sendToHost('xiaochao-focus-webview');
        } catch (error) {
            console.warn('focus webview unavailable:', error);
        }
    },
    onMessageFromMain: (channel ,callback) => {
        ipcRenderer.on(channel,(event, ...args) => {
            callback(event, ...args);
        });
    },
};

/**
 * 按是否开启 contextIsolation 选择暴露方式：
 * 隔离开 → contextBridge；否则直接挂到 window（兼容旧微端壳）。
 */
function exposeApi() {
    if (process.contextIsolated && contextBridge) {
        contextBridge.exposeInMainWorld('WEIDUAN', true);
        contextBridge.exposeInMainWorld('electron', api);
        contextBridge.exposeInMainWorld('xiaochaoStorage', xiaochaoStorage);
        return;
    }
    window.WEIDUAN = true;
    window.electron = api;
    window.xiaochaoStorage = xiaochaoStorage;
}

exposeApi();