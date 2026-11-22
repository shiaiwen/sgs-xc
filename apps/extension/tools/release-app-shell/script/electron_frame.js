

/** 游戏外框页：窗口按钮、多开和与主进程的消息。 */
const electron = require('electron');
const { ipcRenderer } = electron;
const nativeRemote = electron.remote;
const runtimeGlobalFallback = {};
const appPathCache = {};
let runtimeGlobalsLoaded = false;
let localScriptResponseCache = null;
let localScriptInjectCache = null;
let developmentWebviewReady = false;

ipcRenderer.on('xiaochao-dev-script-changed', () => {
    localScriptResponseCache = null;
    localScriptInjectCache = null;
    console.info('[xiaochao-dev] source changed; refresh the game manually to apply it');
});

function getReportWindowPageBridgeScript() {
    return `(() => {
        if (window.__XIAOCHAO_REPORT_WINDOW_BRIDGE__) return;
        window.__XIAOCHAO_REPORT_WINDOW_BRIDGE__ = true;
        // 打开窗口和后续操作必须使用同一个游戏 frame，不能只记住外层 webview。
        const reportSources = new Map();
        const syncRequests = new Map();
        window.electron?.onMessageFromMain?.('xiaochao-goods-flow-sync', payload => {
            if (!payload?.sourceId) return;
            const target = reportSources.get(payload.sourceId);
            if (!target || target.source.closed) {
                window.electron.invoke('xiaochao-goods-flow-sync-result', {
                    rid: payload.rid, ok: false, error: 'goods_flow_sync_unavailable'
                });
                return;
            }
            syncRequests.set(payload.rid, target);
            target.source.postMessage({ type: 'xiaochao-goods-flow-sync-request', payload }, target.origin);
        });
        // 小抄输入框聚焦时同步 webview 键盘焦点；详见 electron_renderer.js 的
        // focusWebview 说明。小抄可能运行在嵌套 frame 里，故统一走 top postMessage。
        window.addEventListener('message', (event) => {
            const request = event && event.data;
            if (!request || request.type !== 'xiaochao-focus-webview') return;
            try {
                if (window.electron && typeof window.electron.focusWebview === 'function') {
                    window.electron.focusWebview();
                }
            } catch (error) {}
        });
        window.addEventListener('message', async (event) => {
            const request = event && event.data;
            if (request?.type === 'xiaochao-goods-flow-sync-response') {
                const pending = syncRequests.get(request.payload?.rid);
                if (!pending || event.source !== pending.source ||
                    (pending.origin !== '*' && event.origin !== pending.origin)) return;
                syncRequests.delete(request.payload.rid);
                await window.electron.invoke('xiaochao-goods-flow-sync-result', request.payload);
                return;
            }
            if (!request || request.type !== 'xiaochao-open-report-window' || typeof request.requestId !== 'string') return;
            const url = String(request.url || '');
            const commaIndex = url.indexOf(',');
            const isHtml = commaIndex > 0 && /^data:text\\/html(?:[;,]|$)/i.test(url.slice(0, commaIndex));
            let success = false;
            if (isHtml && window.electron && typeof window.electron.openWindow === 'function') {
                try {
                    const sourceId = typeof request.sourceId === 'string' ? request.sourceId : '';
                    if (sourceId && event.source) {
                        for (const [id, target] of reportSources) {
                            if (target.source.closed) reportSources.delete(id);
                        }
                        reportSources.set(sourceId, { source: event.source,
                            origin: event.origin && event.origin !== 'null' ? event.origin : '*' });
                    }
                    success = !!(await window.electron.openWindow(url, sourceId || undefined));
                } catch (error) {
                    console.error('打开小抄原生报告窗口失败：', error);
                }
            }
            try {
                if (event.source && typeof event.source.postMessage === 'function') {
                    event.source.postMessage({
                        type: 'xiaochao-open-report-window-result',
                        requestId: request.requestId,
                        success
                    }, event.origin && event.origin !== 'null' ? event.origin : '*');
                }
            } catch (error) {
                console.error('返回小抄原生报告窗口结果失败：', error);
            }
        });
    })();`;
}

function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

function rememberRuntimeGlobal(name, value) {
    if (typeof value !== 'undefined' && value !== null && value !== '') {
        runtimeGlobalFallback[name] = value;
    }
    return value;
}

function fetchRuntimeGlobal(name) {
    if (hasOwn(runtimeGlobalFallback, name)) return runtimeGlobalFallback[name];
    try {
        if (nativeRemote && typeof nativeRemote.getGlobal === 'function') {
            return rememberRuntimeGlobal(name, nativeRemote.getGlobal(name));
        }
        if (ipcRenderer && typeof ipcRenderer.sendSync === 'function') {
            return rememberRuntimeGlobal(name, ipcRenderer.sendSync('get-global-sync', name));
        }
    } catch (error) {
        console.warn('get-global-sync unavailable:', name, error);
    }
    return runtimeGlobalFallback[name];
}

function fetchAppPath(name) {
    if (hasOwn(appPathCache, name)) return appPathCache[name];
    try {
        if (nativeRemote && nativeRemote.app && typeof nativeRemote.app.getPath === 'function') {
            appPathCache[name] = nativeRemote.app.getPath(name);
            return appPathCache[name];
        }
        if (ipcRenderer && typeof ipcRenderer.sendSync === 'function') {
            appPathCache[name] = ipcRenderer.sendSync('get-app-path-sync', name);
            return appPathCache[name];
        }
    } catch (error) {
        console.warn('get app path failed:', name, error);
    }
    appPathCache[name] = '';
    return '';
}

const remote = {
    getGlobal: fetchRuntimeGlobal,
    app: {
        getPath: fetchAppPath
    }
};
//const shell = remote.require('shell');
//loadElectronFrame();
window.ChannelId = '';
window.PackageId = '';
//const fs = require('fs');
//const path = require('path');

//const scriptPath = remote.app.getPath('userData')
const { contextBridge } = require('electron');

// 使用 contextBridge 暴露 API 到渲染进程
// contextBridge.exposeInMainWorld('api', {
//     loadImage: (imgElementId, imagePath) => {
//         // 向主进程请求读取文件
//         ipcRenderer.invoke('load-image', imagePath).then(base64Image => {
//             const imageElement = document.getElementById(imgElementId);
//             imageElement.src = base64Image;
//         }).catch(err => {
//             console.error('Failed to load image:', err);
//         });
//     }
// });

function applyPackageSnapshotCompat(packageObj) {
    if (!packageObj || typeof packageObj !== 'object') return;
    runtimeGlobalFallback.Version = packageObj.version;
    runtimeGlobalFallback.IsTest = packageObj.IsTest;
    runtimeGlobalFallback.PackageId = packageObj.packageId;
    runtimeGlobalFallback.URLOffTest = packageObj.URLOffTest;
    runtimeGlobalFallback.URLLYTest = packageObj.URLLYTest;
    runtimeGlobalFallback.platform = packageObj.platform;
    runtimeGlobalFallback.AutoUpdaterURL = packageObj.AutoUpdaterURL;
    runtimeGlobalFallback.JumpURL = packageObj.JumpURL;
    runtimeGlobalFallback.FeedURL = packageObj.FeedURL;
    runtimeGlobalFallback.LoginURL = packageObj.LoginURL;
    runtimeGlobalFallback.IsDebug = packageObj.IsDebug;
    runtimeGlobalFallback.ChannelId = packageObj.ChannelId;
}

async function ensureRuntimeGlobalsCompat() {
    if (runtimeGlobalsLoaded) return;
    runtimeGlobalsLoaded = true;
    try {
        if (ipcRenderer && typeof ipcRenderer.invoke === 'function') {
            applyPackageSnapshotCompat(await ipcRenderer.invoke('get-package'));
        }
    } catch (error) {
        console.warn('get-package unavailable:', error);
    }
    window.ChannelId = getRemoteGlobalCompat('ChannelId', runtimeGlobalFallback.ChannelId);
    window.PackageId = getRemoteGlobalCompat('PackageId', runtimeGlobalFallback.PackageId);
}

async function loadElectronFrame() {
    await ensureRuntimeGlobalsCompat();
    initElectronFrame();
    ipcRenderer.send("checkForUpdate");
    // var h = document.documentElement.clientHeight;//获取页面可见高度  
    // let wb = document.getElementById('wb');
    // let botView = document.getElementById('fixDiv2');
    // if (wb && botView) {
    //     wb.style.height = h - 80 + 'px'
    //     botView.style.top = h - 50 + 'px';
    // }
}

window.loadElectronFrame = loadElectronFrame;

// 新脚本换好后不刷新游戏页，由页里的小抄挑不打牌的时候自己刷新。
ipcRenderer.on('xiaochao-script-staged', () => {
    localScriptResponseCache = null;
    localScriptInjectCache = null;
});

ipcRenderer.on('payment-authorized', (event, message) => {
    const webview = document.getElementById('wb');
    if (webview) webview.send('payment-authorized', message);
});

ipcRenderer.on('downloadProgress', (event, progressObj) => {
    const updateDiv = document.getElementById('updateDiv');
    if (!updateDiv) return;
    updateDiv.style.visibility = 'visible';
    const percent = progressObj.percent || 1;
    const updateTxt = document.getElementById('updateTxt');
    if (updateTxt) updateTxt.innerHTML = '文件下载中：' + percent.toFixed(2) + '%';
    const updateTxt2 = document.getElementById('updateTxt2');
    if (updateTxt2) updateTxt2.innerHTML = (progressObj.transferred / 1024 / 1024).toFixed(2) + 'M/' + (progressObj.total / 1024 / 1024).toFixed(2) + 'M';
});






ipcRenderer.on('enter-full-screen', (e, msg) => {
    const top = document.getElementById('topDiv');
    const bottom = document.getElementById('topBottmDiv');
    const wd = document.getElementById('wb');
    const wbContainer = document.getElementById('wbContainer');
    const full = msg == 1;
    if (top) top.style.visibility = full ? 'hidden' : 'visible';
    if (bottom) bottom.style.visibility = full ? 'hidden' : 'visible';
    if (wbContainer) {
        wbContainer.style.top = full ? '0px' : '30px';
        wbContainer.style.bottom = full ? '0px' : '0px';
    }
    if (wd && !wbContainer) {
        wd.style.top = full ? '0px' : '30px';
        wd.style.bottom = full ? '0px' : (bottom ? '50px' : '0px');
    }
});

ipcRenderer.on('resize', (e, msg) => {
});


function getRemoteGlobalCompat(name, fallbackValue) {
    try {
        if (remote && typeof remote.getGlobal === 'function') {
            const value = remote.getGlobal(name);
            return typeof value === 'undefined' ? fallbackValue : value;
        }
    } catch (error) {
        console.warn('get remote global failed:', name, error);
    }
    return fallbackValue;
}

function getAppPathCompat(name) {
    try {
        if (remote && remote.app && typeof remote.app.getPath === 'function') {
            const value = remote.app.getPath(name);
            if (value) return value;
        }
    } catch (error) {
        console.warn('get app path failed:', name, error);
    }
    if (name === 'userData') {
        try {
            const path = require('path');
            const appData = process.env.APPDATA || '';
            if (appData) return path.join(appData, 'SGSOL');
        } catch (error) {
            console.warn('fallback userData path failed:', error);
        }
    }
    return '';
}

async function invokeCompat(channel, ...args) {
    try {
        if (ipcRenderer && typeof ipcRenderer.invoke === 'function') {
            return await ipcRenderer.invoke(channel, ...args);
        }
    } catch (error) {
        console.warn('ipc invoke failed:', channel, error);
    }
    return null;
}

function readLocalScriptFromDisk() {
    try {
        const fs = require('fs');
        const path = require('path');
        const userData = getAppPathCompat('userData');
        const candidates = [
            getRemoteGlobalCompat('scriptPath', ''),
            userData ? path.join(userData, '三国杀打小抄.js') : ''
        ].filter(Boolean);

        for (const filePath of candidates) {
            if (fs.existsSync(filePath)) {
                return fs.readFileSync(filePath, 'utf8');
            }
        }
    } catch (error) {
        console.warn('read local script from disk failed:', error);
    }
    return '';
}

/** 每次注入都先问主进程：多开时别的窗口可能已经换了脚本文件，主进程按文件修改时间读最新的。 */
async function readLocalScriptCompat() {
    const asyncResponse = await invokeCompat('read-local-script');
    if (asyncResponse && asyncResponse.success && asyncResponse.data) {
        localScriptResponseCache = asyncResponse;
        return asyncResponse;
    }
    if (localScriptResponseCache && localScriptResponseCache.success && localScriptResponseCache.data) {
        return localScriptResponseCache;
    }

    try {
        const syncResponse = ipcRenderer.sendSync && ipcRenderer.sendSync('read-local-script-sync');
        if (syncResponse && syncResponse.success && syncResponse.data) {
            localScriptResponseCache = syncResponse;
            return syncResponse;
        }
    } catch (error) {
        console.warn('sync read local script failed:', error);
    }

    const data = readLocalScriptFromDisk();
    if (data) {
        localScriptResponseCache = { success: true, data };
        return localScriptResponseCache;
    }
    return {
        success: false,
        error: asyncResponse && asyncResponse.error ? asyncResponse.error : 'local script not found'
    };
}

function jsonLiteralForExecuteJavaScript(value) {
    return JSON.stringify(value)
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function getLocalScriptInjection(data) {
    if (localScriptInjectCache && localScriptInjectCache.data === data) {
        return localScriptInjectCache.code;
    }
    const scriptLiteral = jsonLiteralForExecuteJavaScript(data);
    localScriptInjectCache = {
        data,
        code: `
            (function () {
                try {
                    function remountXiaochaoPanel() {
                        var bridge = window.__XIAOCHAO_ENGINEERING__;
                        if (bridge && typeof bridge.mountPanelShell === 'function') {
                            try { bridge.mountPanelShell(); } catch (error) {
                                console.error('[xiaochao] remount panel failed:', error);
                            }
                        }
                    }
                    if (window.__XIAOCHAO_MICROCLIENT_INJECTED__) {
                        if (!document.getElementById('xiaochao-app')) remountXiaochaoPanel();
                        return;
                    }
                    window.__XIAOCHAO_MICROCLIENT_INJECTED__ = true;
                    var script = document.createElement('script');
                    script.type = 'text/javascript';
                    script.appendChild(document.createTextNode(${scriptLiteral}));
                    (document.body || document.documentElement).appendChild(script);
                } catch (error) {
                    console.error('[xiaochao] local script injection failed:', error);
                }
            })();
        `
    };
    return localScriptInjectCache.code;
}


async function loadScript(webview) {
    const pageUrl = webview.getURL();
    const response = await readLocalScriptCompat();
    // const videoPath = remote.getGlobal('videoPath'); // 你的视频文件路径

    if (response.success) {
        if (!webview.isConnected || webview.getURL() !== pageUrl) return;
        // const videoFilePath = 'myprotocol:/3.mp4'; // 替换为你实际的3.mp4路径


        const result = webview.executeJavaScript(getLocalScriptInjection(response.data));
        if (result && typeof result.catch === 'function') {
            result.catch((error) => console.error('local script injection failed:', error));
        }
    } else {
        console.error(response.error || '本地小抄脚本不可用，已跳过注入');
    }
}

function installReportWindowPageBridge(webview) {
    const result = webview.executeJavaScript(getReportWindowPageBridgeScript());
    if (result && typeof result.catch === 'function') {
        result.catch((error) => console.error('安装小抄原生报告窗口桥接失败：', error));
    }
}

function initElectronFrame() {


    var max = document.getElementById('max');
    if (max) {
        max.addEventListener('click', () => {
            //发送最大化命令
            ipcRenderer.send('window-max');
            //最大化图形切换
            if (max.getAttribute('name') == 'max') {
                max.setAttribute('name', 'min');
            } else {
                max.setAttribute('name', 'max');
            }
            if (max.getAttribute('name') == 'max') {
                max.setAttribute('src', 'res/button_05.png');
            } else {
                max.setAttribute('src', 'res/button_01.png');
            }

        })

        max.addEventListener('mousemove', () => {
            //最大化图形切换
            if (max.getAttribute('name') == 'max') {
                max.setAttribute('src', 'res/button_06.png');
            } else {
                max.setAttribute('src', 'res/button_02.png');
            }
        })
        max.addEventListener('mouseout', () => {
            if (max.getAttribute('name') == 'max') {
                max.setAttribute('src', 'res/button_05.png');
            } else {
                max.setAttribute('src', 'res/button_01.png');
            }
        })
    }

    var min = document.getElementById('min');
    if (min) {
        min.addEventListener('click', () => {
            //发送最小化命令
            ipcRenderer.send('window-min');
        })
    }

    var close = document.getElementById('close');
    if (close) {
        close.addEventListener('click', () => {
            ipcRenderer.send('window-close');
        })
    }
    const feed = document.getElementById('eFeed');
    if (feed) feed.addEventListener('click', () => ipcRenderer.send('e-feed'));
    const office = document.getElementById('eOffice');
    if (office) office.addEventListener('click', () => ipcRenderer.send('e-office'));
    const chagre = document.getElementById('eChagre');
    if (chagre) {
        chagre.addEventListener('click', () => {
            const webview = document.getElementById('wb');
            if (!webview) return;
            webview.executeJavaScript("if(window.OpenPay){ window.OpenPay(); }");
        });
    }
    const clear = document.getElementById('eClear');
    if (clear) clear.addEventListener('click', () => ipcRenderer.send('e-clear'));
    const searchBtn = document.getElementById('eBtn');
    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            const input = document.getElementById('eInput');
            ipcRenderer.send('e-search', input ? input.value : '三国杀OL');
        });
    }
    let setting = document.getElementById('icon') || document.getElementById('setting') || document.getElementById('WDVerSion') || document.querySelector('#topDiv img');
    if (setting) {
        setting.style.webkitAppRegion = 'no-drag';
        setting.addEventListener('click', () => {
            ipcRenderer.send('show-context-menu');
        });
        setting.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            ipcRenderer.send('show-context-menu');
        });
    }
    // let  menu = document.getElementById('cmenu');
    // if (menu) {
    //     setting.addEventListener('mouseover', () => {
    //         ipcRenderer.send('show-context-menu');
    //     })
    // }

    let webview = document.getElementById('wb');
    // let sidebar = document.getElementById('sidebar');
    // sidebar.addEventListener("dom-ready", function () {
    //     //alert(sidebar.src)
    //
    //     // ipcRenderer.on('onF6', (e, msg) => {
    //         sidebar.openDevTools({ mode: 'detach' })
    //     // })
    //     ipcRenderer.on('console-message-sidebar', (e, msg) => {
    //         console.warn(msg);
    //     });
    // })
    var loginURL = getRemoteGlobalCompat('LoginURL', []);
    var loginForm = Number(getRemoteGlobalCompat('PackageId', 1)) || 1;

    if (getRemoteGlobalCompat('IsTest', false)) {
        if (loginForm == 1 || loginForm == 2) {
            webview.src = getRemoteGlobalCompat('URLOffTest', '');
        } else {
            webview.src = getRemoteGlobalCompat('URLLYTest', '');
        }
    } else {
        let src = Array.isArray(loginURL) ? loginURL[loginForm - 1] : loginURL;
        if (src) {
            src += src.indexOf('?') !== -1 ? '&t=' + Math.floor(Date.now()) : '?t=' + Math.floor(Date.now());
            webview.src = src;
        }
    }
    //webview.src = 'http://10.225.11.80:8080'
    const msgList = {
        channel(packageId) {
            const list = Array.isArray(loginURL) ? loginURL : [];
            const index = Number(packageId) - 1;
            let url = list[index] || list[0];
            if (!url) return;
            url += url.indexOf('?') !== -1 ? '&t=' + Date.now() : '?t=' + Math.floor(Date.now());
            try {
                if (developmentWebviewReady) {
                    webview.loadURL(url);
                    return;
                }
            } catch (error) {
                console.warn('切换大区时 loadURL 失败，改为设置 src', error);
            }
            webview.src = url;
        },
        executeJS(str) {
            if (typeof str !== 'string' || !str.trim()) return;
            const result = webview.executeJavaScript(`(()=>{try{${str}}catch(error){console.error('[xiaochao] rendererMsg executeJS failed:',error);}})()`);
            if (result && typeof result.catch === 'function') {
                result.catch((error) => console.error('[xiaochao] rendererMsg executeJS failed:', error));
            }
        },
        changeSize(wh) {

            let dimensions = wh.split('*');
            let width = dimensions[0];
            let height = dimensions[1];
            webview
              .executeJavaScript(
                `console.warn(wh);if(window.SystemContext){
                    window.SystemContext.GAME_MIN_WIDTH = '${width}'
                    window.SystemContext.GAME_MIN_HEIGHT = '${height}'
                  }`
              )
              .then(() => {
                  ipcRenderer.send('setBounds')
              })
        },
    }

    window.msgList = msgList
    ipcRenderer.on('rendererMsg', (e, msg, param) => {
        if (msgList[msg]) msgList[msg](param)
    })
    let isDeBug = getRemoteGlobalCompat('IsDebug', false);
    webview.setAttribute("IsDebug", isDeBug)
    if (!webview.__sgsolF6Bound) {
        webview.__sgsolF6Bound = true;
        ipcRenderer.on('onF6', (e, msg) => {
            webview.openDevTools({ mode: 'detach' })
        })
    }
    if (!webview.__xcFocusWebviewBound) {
        webview.__xcFocusWebviewBound = true;
        // 小抄输入框聚焦时（经 electron_renderer.js 的 focusWebview 转发）把原生
        // 键盘焦点/输入法状态委派回 webview，修复旧版 Chromium guest 焦点脱钩
        // 导致的按键丢失与中文输入法失效。
        webview.addEventListener('ipc-message', (event) => {
            if (event.channel === 'xiaochao-focus-webview') webview.focus();
        });
    }
    webview.addEventListener("dom-ready", function () {
        developmentWebviewReady = true;
        installReportWindowPageBridge(webview);
        loadScript(webview);
    })
}

ipcRenderer.on('set-video-path', (event, url) => {
    const index = url.indexOf('?');
    if (index !== -1) {
        url = url.substring(0, index);
    }
    const webview = document.getElementById('wb');
    if (!webview) return;
    const safeUrl = jsonLiteralForExecuteJavaScript(url);
    const result = webview.executeJavaScript(`(()=>{try{var node=document.getElementById('sgsBgVideo');if(node)node.src=${safeUrl};}catch(error){console.error('[xiaochao] set-video-path failed:',error);}})()`);
    if (result && typeof result.catch === 'function') {
        result.catch((error) => console.error('[xiaochao] set-video-path failed:', error));
    }
});

// ipcRenderer.on('set-title', (event, title) => {
//     document.title = title;
//     const WDVerTxt = document.getElementById('WDVerSion');
//     if (WDVerTxt) {
//         WDVerTxt.innerHTML = title;
//
//         WDVerTxt.addEventListener('contextmenu', (e) => {
//             e.preventDefault();
//             WDVerTxt.innerHTML = 'title';
//             //ipcRenderer.send('show-context-menu');
//         }, false);
//     }
// });

// ipcRenderer.on('context-menu-command', (event, command) => {
//     let element = document.getElementById('WDVerSion');
//     element.innerHTML = 'o444';
//
//     if (command === 'option1') {
//         // 执行 Option 1 的操作
//         element.innerHTML = 'o1';
//
//     } else if (command === 'option2') {
//         // 执行 Option 2 的操作
//         element.innerHTML = 'o2';
//     }
// });
