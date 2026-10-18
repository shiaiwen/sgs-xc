/** 微端更新：下载、校验并替换客户端文件。 */
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { buildWindowsMicroClientUpdater } = require('./micro-client-updater');

const MANIFEST_URL = 'https://95chong.cn/api/xiaochao-version';
const APP_URL = 'https://xc.95chong.cn/downloads/app.zip';
const REQUEST_TIMEOUT_MS = 15000;
const DOWNLOAD_TIMEOUT_MS = 120000;
const MAX_UPDATE_BYTES = 100 * 1024 * 1024;
const MAX_REDIRECTS = 5;

function sha256File(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
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

function isValidManifest(manifest) {
    return Boolean(manifest)
        && /^\d+\.\d+\.\d+$/.test(String(manifest.version || ''))
        && String(manifest.appUrl || '').split('?')[0] === APP_URL
        && /^[a-f0-9]{64}$/.test(String(manifest.appSha256 || ''));
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

/** 用户目录里的脚本和安装包里的脚本都看，取读得到的较新号。读不到就不拿 0.0.0 充数。 */
function readLocalScriptVersion(getScriptPath) {
    const versions = [readScriptVersion(getScriptPath()), readScriptVersion(path.join(__dirname, 'xiaochao.js'))]
        .filter((version) => /^\d+\.\d+\.\d+$/.test(version));
    return versions.reduce((best, version) => (
        best && compareVersions(version, best) <= 0 ? best : version
    ), '');
}

/**
 * 正式包启动后检查门户清单。脚本版本更高时下载 app.zip，校验后弹 UAC，
 * 等本进程退出再替换 resources/app 并重新打开微端。
 */
function scheduleMicroClientUpdate(deps) {
    const {
        app,
        dialog,
        BrowserWindow,
        screen,
        getMainWindow,
        logMessage,
        getScriptPath
    } = deps;
    if (process.platform !== 'win32') return;

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

    const declinedVersions = new Set();
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
        if (now - lastCheckAt < 5000 && lastCheckAt !== 0) return;
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

    async function run() {
        const currentVersion = readLocalScriptVersion(getScriptPath);
        if (!currentVersion) {
            logMessage('micro-client script version unreadable, skip update check');
            return;
        }
        logMessage(`micro-client update check started, script=${currentVersion}`);
        let manifest;
        try {
            manifest = await fetchJson(`${MANIFEST_URL}?t=${Date.now()}`);
        } catch (error) {
            logMessage(`micro-client manifest fetch failed, skip update check: ${error.message}`);
            return;
        }
        if (!isValidManifest(manifest) || compareVersions(manifest.version, currentVersion) <= 0) {
            logMessage('micro-client is up to date or manifest invalid');
            return;
        }
        if (!app.isPackaged) {
            logMessage(`micro-client update available ${manifest.version}, skip install while unpackaged`);
            return;
        }
        const latestLocalVersion = readLocalScriptVersion(getScriptPath);
        if (!latestLocalVersion) return;
        if (compareVersions(manifest.version, latestLocalVersion) <= 0) {
            logMessage(`micro-client already updated before prompt, script=${latestLocalVersion}`);
            return;
        }
        if (declinedVersions.has(manifest.version)) return;
        const confirm = await present({
            type: 'info',
            title: '微端更新',
            message: `检测到新版本 ${manifest.version}，将更新微端与小抄，是否立即更新？`,
            detail: `当前小抄 ${latestLocalVersion}`,
            buttons: ['立即更新', '暂不更新'],
            defaultId: 0,
            cancelId: 1
        });
        if (confirm.response !== 0) {
            declinedVersions.add(manifest.version);
            return;
        }

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
        });
    }
}

module.exports = {
    scheduleMicroClientUpdate,
    fetchJson,
    compareVersions,
    isValidManifest,
    readScriptVersion
};
