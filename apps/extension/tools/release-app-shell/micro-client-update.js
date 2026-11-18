/**
 * 微端更新：后台下载新脚本换进用户目录，不刷新游戏页；游戏页里的小抄问到新版就绪后，
 * 自己挑不打牌的时候刷新。微端外壳变了才走整包，整包要确认和管理员授权，只在启动后不久问。
 */
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
/** 整包更新才需要；勿顶层 require，缺文件时不应拖垮主进程启动。 */
function loadWindowsMicroClientUpdater() {
    const updaterModulePath = path.join(__dirname, 'micro-client-updater.js');
    if (!fs.existsSync(updaterModulePath)) {
        throw new Error('缺少微端更新辅助模块 micro-client-updater.js（请重新安装完整包）');
    }
    try {
        return require('./micro-client-updater');
    } catch (error) {
        const message = error && error.message ? error.message : String(error);
        throw new Error('无法加载微端更新辅助模块 micro-client-updater.js: ' + message);
    }
}

const MANIFEST_URL = 'https://95chong.cn/api/xiaochao-version';
const APP_URL = 'https://xc.95chong.cn/downloads/app.zip';
/** 稳定地址：勿在常量上加会变的 query；下载时再临时加 t= 防缓存。 */
const SCRIPT_URL = 'https://xc.95chong.cn/downloads/xiaochao.js';
const REQUEST_TIMEOUT_MS = 15000;
const DOWNLOAD_TIMEOUT_MS = 120000;
const MAX_UPDATE_BYTES = 100 * 1024 * 1024;
const MAX_SCRIPT_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 5;
/** 和小抄里 MICRO_CLIENT_UPDATE_STATUS_CHANNEL 一致。 */
const UPDATE_STATUS_CHANNEL = 'xiaochao-update-status';
/** 整包更新要弹确认框，只在启动后这段时间里问，免得打牌中途弹出来。 */
const FULL_PACKAGE_PROMPT_WINDOW_MS = 3 * 60 * 1000;
const MANUAL_CHECK_THROTTLE_MS = 5000;
/** 脚本下载出错后过多久自己再试一次，每个版本只自动重试一次。 */
const SCRIPT_RETRY_DELAY_MS = 2 * 60 * 1000;

function sha256File(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sha256Buffer(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function compareVersions(left, right) {
    const leftParts = String(left || '0').split('.').map((part) => Number.parseInt(part, 10) || 0);
    const rightParts = String(right || '0').split('.').map((part) => Number.parseInt(part, 10) || 0);
    const length = Math.max(leftParts.length, rightParts.length);
    for (let index = 0; index < length; index += 1) {
        if ((leftParts[index] || 0) > (rightParts[index] || 0)) return 1;
        if ((leftParts[index] || 0) < (rightParts[index] || 0)) return -1;
    }
    return 0;
}

function requestBuffer(url, maxBytes, timeoutMs = REQUEST_TIMEOUT_MS, onProgress, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        const client = target.protocol === 'http:' ? http : https;
        let settled = false;
        let received = 0;
        let responseLength = 0;
        const chunks = [];
        let timeout;
        const finish = (error, result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (error) reject(error);
            else resolve(result);
        };
        const request = client.get(target, (response) => {
            const statusCode = response.statusCode || 0;
            if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
                if (redirectCount >= MAX_REDIRECTS) {
                    response.resume();
                    finish(new Error('too many redirects while downloading update'));
                    return;
                }
                response.resume();
                requestBuffer(
                    new URL(response.headers.location, target).toString(),
                    maxBytes,
                    timeoutMs,
                    onProgress,
                    redirectCount + 1
                ).then((result) => finish(null, result), (error) => finish(error));
                return;
            }
            responseLength = Number(response.headers['content-length']);
            if (maxBytes && Number.isFinite(responseLength) && responseLength > maxBytes) {
                response.resume();
                finish(new Error('update response is too large'));
                return;
            }
            if (onProgress) onProgress({ received, total: responseLength });
            response.on('data', (chunk) => {
                received += chunk.length;
                if (maxBytes && received > maxBytes) {
                    request.destroy(new Error('update response is too large'));
                    return;
                }
                chunks.push(chunk);
                if (onProgress) onProgress({ received, total: responseLength });
            });
            response.on('end', () => {
                if (Number.isFinite(responseLength) && received !== responseLength) {
                    finish(new Error(`incomplete update response (${received}/${responseLength} bytes)`));
                    return;
                }
                finish(null, { statusCode, body: Buffer.concat(chunks) });
            });
            response.on('aborted', () => finish(new Error('update response was interrupted')));
            response.on('error', (error) => finish(error));
        });
        timeout = setTimeout(() => {
            request.destroy(new Error(`request timed out after ${Math.round(timeoutMs / 1000)} seconds`));
        }, timeoutMs);
        request.setTimeout(timeoutMs, () => {
            request.destroy(new Error(`connection idle for ${Math.round(timeoutMs / 1000)} seconds`));
        });
        request.on('error', (error) => finish(error));
    });
}

/** 检查更新直接请求版本接口，不再用浏览器打开页面再抠正文。 */
async function fetchJson(url) {
    const { statusCode, body } = await requestBuffer(url, 1024 * 1024);
    if (statusCode !== 200) throw new Error(`Failed to get '${url}' (${statusCode})`);
    try {
        return JSON.parse(body.toString('utf8'));
    } catch (error) {
        throw new Error(`invalid JSON response from '${url}': ${error.message || error}`);
    }
}

function downloadFile(url, localFilePath, onProgress) {
    return requestBuffer(url, MAX_UPDATE_BYTES, DOWNLOAD_TIMEOUT_MS, onProgress).then(({ statusCode, body }) => {
        if (statusCode !== 200) throw new Error(`Failed to get '${url}' (${statusCode})`);
        fs.mkdirSync(path.dirname(localFilePath), { recursive: true });
        fs.writeFileSync(localFilePath, body);
    });
}

function isValidAppManifest(manifest) {
    return Boolean(manifest)
        && /^\d+\.\d+\.\d+$/.test(String(manifest.version || ''))
        && String(manifest.appUrl || '').split('?')[0] === APP_URL
        && /^[a-f0-9]{64}$/.test(String(manifest.appSha256 || ''));
}

/** 脚本级无感热更：稳定 scriptUrl + sha256。 */
function isValidScriptManifest(manifest) {
    return Boolean(manifest)
        && /^\d+\.\d+\.\d+$/.test(String(manifest.version || ''))
        && String(manifest.scriptUrl || '').split('?')[0] === SCRIPT_URL
        && /^[a-f0-9]{64}$/.test(String(manifest.scriptSha256 || ''));
}

function isValidManifest(manifest) {
    return isValidAppManifest(manifest) || isValidScriptManifest(manifest);
}

function readScriptVersion(scriptPath) {
    try {
        if (!scriptPath || !fs.existsSync(scriptPath)) return '';
        const text = fs.readFileSync(scriptPath, 'utf8');
        const match = text.match(/@version\s+(\d+\.\d+\.\d+)/);
        return match ? match[1] : '';
    } catch (error) {
        return '';
    }
}

function readScriptVersionFromText(text) {
    const match = String(text || '').match(/@version\s+(\d+\.\d+\.\d+)/);
    return match ? match[1] : '';
}

/** 用户目录里的脚本和安装包里的脚本都看，取读得到的较新号。读不到就不拿 0.0.0 充数。 */
function readLocalScriptVersion(getScriptPath) {
    const versions = [readScriptVersion(getScriptPath()), readScriptVersion(path.join(__dirname, 'xiaochao.js'))]
        .filter((version) => /^\d+\.\d+\.\d+$/.test(version));
    return versions.reduce((best, version) => (
        best && compareVersions(version, best) <= 0 ? best : version
    ), '');
}

/** 壳版本写在 package.json 的 xiaochaoShellVersion，是个整数；没有这个字段的旧壳当成 0。 */
function readShellVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
        return normalizeShellVersion(pkg.xiaochaoShellVersion);
    } catch (error) {
        return 0;
    }
}

function normalizeShellVersion(value) {
    const version = Number(value);
    return Number.isSafeInteger(version) && version > 0 ? version : 0;
}

function writeScriptAtomically(scriptPath, body) {
    const directory = path.dirname(scriptPath);
    const tempPath = path.join(directory, `xiaochao.js.${process.pid}.hot.tmp`);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(tempPath, body);
    if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
    fs.renameSync(tempPath, scriptPath);
}

/**
 * 正式包启动后检查门户清单。
 * 脚本：scriptUrl → 写入 userData/xiaochao.js → 清缓存，等游戏页自己刷新（无确认、无 UAC）。
 * 整包：清单里的壳版本比本地新，或者清单没有可用的 scriptUrl 时，确认 + UAC 安装 app.zip。
 * 传了 ipcMain 才登记进度通道；不登记时游戏页里的小抄只提示手动更新。
 */
function scheduleMicroClientUpdate(deps) {
    const {
        app,
        dialog,
        BrowserWindow,
        screen,
        getMainWindow,
        logMessage,
        getScriptPath,
        clearLocalScriptCache,
        notifyScriptStaged,
        ipcMain
    } = deps;
    if (process.platform !== 'win32') return;

    const startedAt = Date.now();
    const localShellVersion = readShellVersion();
    /** 不装整包就换不上的线上版本，例如清单里没有可用的脚本地址；成功或重新检查时清空。下载出错不算，过一会儿会再试。 */
    let failedVersion = '';
    const retriedVersions = new Set();
    /** 线上要求更新外壳时记下线上版本，游戏页据此提示手动装整包。 */
    let shellUpdateVersion = '';
    const injectedVersionCache = { sourcePath: '', mtimeMs: -1, size: -1, version: '' };

    /** 下次刷新游戏页时会注入的脚本版本：用户目录有脚本就用它，否则用安装包里的。 */
    function readInjectedScriptVersion() {
        const userScriptPath = getScriptPath();
        const sourcePath = userScriptPath && fs.existsSync(userScriptPath)
            ? userScriptPath
            : path.join(__dirname, 'xiaochao.js');
        try {
            const stat = fs.statSync(sourcePath);
            if (
                injectedVersionCache.sourcePath === sourcePath
                && injectedVersionCache.mtimeMs === stat.mtimeMs
                && injectedVersionCache.size === stat.size
            ) {
                return injectedVersionCache.version;
            }
            const version = readScriptVersion(sourcePath);
            Object.assign(injectedVersionCache, { sourcePath, mtimeMs: stat.mtimeMs, size: stat.size, version });
            return version;
        } catch (error) {
            return '';
        }
    }

    let updateProgressWindow = null;

    function showProgress(text) {
        const mainWindow = getMainWindow();
        if (updateProgressWindow && !updateProgressWindow.isDestroyed()) {
            updateProgressWindow.webContents.executeJavaScript(
                `document.body.innerHTML = ${JSON.stringify(String(text).replace(/\n/g, '<br>'))};`
            ).catch(() => {});
            return;
        }
        const win = new BrowserWindow({
            width: 420,
            height: 140,
            parent: mainWindow || undefined,
            frame: false,
            closable: false,
            resizable: false,
            minimizable: false,
            maximizable: false,
            show: false,
            skipTaskbar: true,
            webPreferences: { nodeIntegration: false, contextIsolation: true }
        });
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
            body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;font-size:16px;background:#f5f5f5;color:#333;}
        </style></head><body><div>${String(text).replace(/\n/g, '<br>')}</div></body></html>`;
        win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
        win.once('ready-to-show', () => {
            const display = mainWindow && !mainWindow.isDestroyed()
                ? screen.getDisplayMatching(mainWindow.getBounds())
                : screen.getPrimaryDisplay();
            const area = display.workArea;
            win.setBounds({
                x: Math.round(area.x + (area.width - 420) / 2),
                y: Math.round(area.y + area.height - 140 - 48),
                width: 420,
                height: 140
            });
            win.show();
        });
        updateProgressWindow = win;
    }

    function closeProgress() {
        if (updateProgressWindow && !updateProgressWindow.isDestroyed()) updateProgressWindow.close();
        updateProgressWindow = null;
    }

    async function present(options) {
        const mainWindow = getMainWindow();
        if (!mainWindow || mainWindow.isDestroyed()) {
            return { response: options.cancelId != null ? options.cancelId : 1 };
        }
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        return dialog.showMessageBox(mainWindow, options);
    }

    const promptedVersions = new Set();
    let running = false;
    let queued = false;
    let lastCheckAt = 0;

    function arm(target) {
        if (!target || target.isDestroyed?.() || target.__xcUpdateCheckArmed) return;
        target.__xcUpdateCheckArmed = true;
        const kick = () => {
            queueCheck();
        };
        target.on?.('show', kick);
        target.on?.('focus', kick);
        target.webContents?.on?.('did-finish-load', kick);
    }

    function queueCheck() {
        const now = Date.now();
        if (now - lastCheckAt < MANUAL_CHECK_THROTTLE_MS && lastCheckAt !== 0) return;
        arm(getMainWindow());
        if (running) {
            queued = true;
            return;
        }
        running = true;
        lastCheckAt = now;
        run().catch((error) => {
            logMessage(`micro-client update failed: ${error.message}`);
            closeProgress();
            const mainWindow = getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
                dialog.showMessageBox(mainWindow, {
                    type: 'error',
                    title: '微端更新失败',
                    message: error.message || '更新下载失败，请稍后再试。',
                    buttons: ['确定']
                }).catch(() => {});
            }
        }).finally(() => {
            running = false;
            if (queued) {
                queued = false;
                lastCheckAt = 0;
                queueCheck();
            }
        });
    }

    setTimeout(queueCheck, 500);
    setTimeout(queueCheck, 8000);

    if (ipcMain && typeof ipcMain.handle === 'function') {
        ipcMain.removeHandler(UPDATE_STATUS_CHANNEL);
        ipcMain.handle(UPDATE_STATUS_CHANNEL, (_event, request) => {
            if (request && request.check === true) {
                failedVersion = '';
                lastCheckAt = 0;
                queueCheck();
            }
            return {
                supported: true,
                scriptVersion: readInjectedScriptVersion(),
                failedVersion,
                shellUpdateVersion
            };
        });
    }

    /** 无感：下载脚本 → userData → 清缓存，不刷新游戏页。失败只记日志，不弹窗。 */
    async function applySilentScriptHotUpdate(manifest) {
        const scriptPath = getScriptPath();
        if (!scriptPath) {
            logMessage('micro-client script hot update skipped: scriptPath empty');
            return false;
        }
        const downloadUrl = new URL(manifest.scriptUrl);
        downloadUrl.searchParams.set('t', String(Date.now()));
        logMessage(`micro-client script hot update downloading ${downloadUrl.toString()}`);
        const { statusCode, body } = await requestBuffer(
            downloadUrl.toString(),
            MAX_SCRIPT_BYTES,
            DOWNLOAD_TIMEOUT_MS
        );
        if (statusCode !== 200) {
            throw new Error(`script download failed (${statusCode})`);
        }
        if (sha256Buffer(body) !== String(manifest.scriptSha256)) {
            throw new Error('script sha256 mismatch');
        }
        const remoteVersion = readScriptVersionFromText(body.toString('utf8'));
        if (!remoteVersion || compareVersions(remoteVersion, manifest.version) < 0) {
            throw new Error(`script @version invalid or older than manifest (${remoteVersion || 'none'})`);
        }
        const latestLocalVersion = readLocalScriptVersion(getScriptPath);
        if (latestLocalVersion && compareVersions(remoteVersion, latestLocalVersion) <= 0) {
            logMessage(`micro-client script already current before write, script=${latestLocalVersion}`);
            return true;
        }
        writeScriptAtomically(scriptPath, body);
        if (typeof clearLocalScriptCache === 'function') clearLocalScriptCache();
        if (typeof notifyScriptStaged === 'function') {
            try {
                notifyScriptStaged();
            } catch (error) {
                logMessage(`micro-client script staged notify failed: ${error.message}`);
            }
        }
        logMessage(`micro-client script staged v${remoteVersion}, waiting for page reload (silent, no UAC)`);
        return true;
    }

    async function run() {
        const currentVersion = readLocalScriptVersion(getScriptPath);
        if (!currentVersion) {
            logMessage('micro-client script version unreadable, skip update check');
            return;
        }
        logMessage(`micro-client update check started, script=${currentVersion}, shell=${localShellVersion}`);
        let manifest;
        try {
            manifest = await fetchJson(`${MANIFEST_URL}?t=${Date.now()}`);
        } catch (error) {
            logMessage(`micro-client manifest fetch failed, skip update check: ${error.message}`);
            return;
        }
        if (!isValidManifest(manifest)) {
            logMessage('micro-client manifest invalid');
            return;
        }

        const shellOutdated = normalizeShellVersion(manifest.shellVersion) > localShellVersion;
        shellUpdateVersion = shellOutdated ? manifest.version : '';
        if (shellOutdated && await offerFullPackage(manifest, currentVersion)) return;

        const latestLocalVersion = readLocalScriptVersion(getScriptPath);
        if (!latestLocalVersion) return;
        if (compareVersions(manifest.version, latestLocalVersion) <= 0) {
            failedVersion = '';
            logMessage(`micro-client script is up to date, script=${latestLocalVersion}`);
            return;
        }

        // 外壳没换或者玩家没装整包，脚本照样在后台换好。
        if (isValidScriptManifest(manifest)) {
            try {
                const staged = await applySilentScriptHotUpdate(manifest);
                failedVersion = staged ? '' : manifest.version;
            } catch (error) {
                logMessage(`micro-client script hot update failed: ${error.message}`);
                scheduleScriptRetry(manifest.version);
            }
            return;
        }

        // 清单没有可用的脚本地址，只能装整包。
        failedVersion = manifest.version;
        if (!shellOutdated) await offerFullPackage(manifest, latestLocalVersion);
    }

    function scheduleScriptRetry(version) {
        if (retriedVersions.has(version)) return;
        retriedVersions.add(version);
        setTimeout(() => {
            lastCheckAt = 0;
            queueCheck();
        }, SCRIPT_RETRY_DELAY_MS);
    }

    /** 问玩家要不要装整包：只在启动后不久问，每次启动同一个版本只问一次。返回是否已经开始安装。 */
    async function offerFullPackage(manifest, localScriptVersion) {
        if (!isValidAppManifest(manifest)) {
            logMessage('micro-client full-package path skipped: app manifest fields missing');
            return false;
        }
        if (!app.isPackaged) {
            logMessage(`micro-client update available ${manifest.version}, skip full install while unpackaged`);
            return false;
        }
        if (promptedVersions.has(manifest.version)) return false;
        if (Date.now() - startedAt > FULL_PACKAGE_PROMPT_WINDOW_MS) {
            logMessage(`micro-client full package ${manifest.version} waits for next launch`);
            return false;
        }
        promptedVersions.add(manifest.version);
        const confirm = await present({
            type: 'info',
            title: '微端更新',
            message: `检测到新版本 ${manifest.version}，将更新微端与小抄，是否立即更新？`,
            detail: `这次要更新微端本体，需要管理员授权。当前小抄 ${localScriptVersion}`,
            buttons: ['立即更新', '暂不更新'],
            defaultId: 0,
            cancelId: 1
        });
        if (confirm.response !== 0) return false;

        const updateDirectory = path.join(app.getPath('userData'), 'xiaochao-update');
        const archivePath = path.join(updateDirectory, `app-${manifest.version}.zip`);
        fs.mkdirSync(updateDirectory, { recursive: true });
        showProgress('正在连接更新服务器…\n请保持微端运行');
        const downloadUrl = new URL(manifest.appUrl);
        downloadUrl.searchParams.set('t', String(Date.now()));
        let lastProgressAt = 0;
        try {
            await downloadFile(downloadUrl.toString(), archivePath, ({ received, total }) => {
                const now = Date.now();
                if (now - lastProgressAt < 250 && (!total || received < total)) return;
                lastProgressAt = now;
                if (total > 0) {
                    const percent = Math.min(100, Math.floor(received / total * 100));
                    showProgress(`正在下载更新 ${percent}%\n${Math.ceil(received / 1024)} / ${Math.ceil(total / 1024)} KB`);
                } else {
                    showProgress(`正在下载更新\n已接收 ${Math.ceil(received / 1024)} KB`);
                }
            });
        } catch (error) {
            closeProgress();
            throw error;
        }
        if (sha256File(archivePath) !== manifest.appSha256) {
            fs.unlinkSync(archivePath);
            closeProgress();
            throw new Error('微端更新包校验失败');
        }

        const updaterPath = path.join(updateDirectory, 'apply-update.ps1');
        const launcherPath = path.join(updateDirectory, 'launch-update.ps1');
        const statusPath = path.join(updateDirectory, 'update-status.txt');
        const { buildWindowsMicroClientUpdater } = loadWindowsMicroClientUpdater();
        const { updaterSource, launcherSource } = buildWindowsMicroClientUpdater({
            parentPid: process.pid,
            archivePath,
            resourcesPath: process.resourcesPath,
            executablePath: app.getPath('exe'),
            updaterPath,
            launcherPath,
            statusPath
        });
        fs.writeFileSync(updaterPath, updaterSource, 'utf8');
        fs.writeFileSync(launcherPath, launcherSource, 'utf8');
        closeProgress();
        await present({
            type: 'info',
            title: '需要管理员权限',
            message: '即将弹出 Windows 用户账户控制（UAC）窗口。',
            detail: '请点击「是」以完成微端更新。若点击「否」或关闭弹窗，更新将不会生效。',
            buttons: ['继续']
        });

        const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcherPath], {
            stdio: 'ignore',
            windowsHide: true
        });
        child.once('exit', (code) => {
            logMessage(`micro-client updater exited with code ${code}`);
            if (code === 0) {
                app.quit();
                return;
            }
            const mainWindow = getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
                dialog.showMessageBox(mainWindow, {
                    type: 'warning',
                    title: '更新未应用',
                    message: '管理员授权被取消，或更新器准备失败。微端将继续使用当前版本。',
                    buttons: ['确定']
                }).catch(() => {});
            }
            lastCheckAt = 0;
            queueCheck();
        });
        return true;
    }
}

module.exports = {
    scheduleMicroClientUpdate,
    fetchJson,
    compareVersions,
    isValidManifest,
    isValidScriptManifest,
    isValidAppManifest,
    readScriptVersion,
    SCRIPT_URL,
    APP_URL
};
