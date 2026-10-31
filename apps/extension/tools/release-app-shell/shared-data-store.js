/**
 * 微端侧大文件存储：自定义背景视频等，避免 IndexedDB 配额与 mime 丢失。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function accountPaths(directory, accountKey) {
    const hash = crypto.createHash('sha256').update(String(accountKey)).digest('hex').slice(0, 32);
    return {
        data: path.join(directory, `${hash}.bin`),
        meta: path.join(directory, `${hash}.json`)
    };
}

function createCustomBackgroundDiskStore(directory) {
    return async (operation) => {
        const action = operation && operation.action;
        const accountKey = String(operation && operation.accountKey || '');
        if (!accountKey || accountKey.length > 128) throw new Error('invalid custom background account key');
        await fs.promises.mkdir(directory, { recursive: true });
        const paths = accountPaths(directory, accountKey);
        if (action === 'get') {
            try {
                const [metaRaw, body] = await Promise.all([
                    fs.promises.readFile(paths.meta, 'utf8'),
                    fs.promises.readFile(paths.data)
                ]);
                const meta = JSON.parse(metaRaw);
                return {
                    buffer: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
                    meta
                };
            } catch (error) {
                if (error && error.code === 'ENOENT') return null;
                throw error;
            }
        }
        if (action === 'remove') {
            await Promise.all([
                fs.promises.unlink(paths.data).catch((error) => (error.code === 'ENOENT' ? undefined : Promise.reject(error))),
                fs.promises.unlink(paths.meta).catch((error) => (error.code === 'ENOENT' ? undefined : Promise.reject(error)))
            ]);
            return true;
        }
        if (action === 'put') {
            const buffer = operation.buffer;
            const meta = operation.meta && typeof operation.meta === 'object' ? operation.meta : {};
            if (!buffer) throw new Error('missing custom background buffer');
            const body = Buffer.from(buffer);
            const tmp = `${paths.data}.tmp`;
            await fs.promises.writeFile(tmp, body, { flag: 'w' });
            await fs.promises.rename(tmp, paths.data);
            await fs.promises.writeFile(paths.meta, JSON.stringify(meta), 'utf8');
            return true;
        }
        throw new Error('invalid custom background operation');
    };
}

module.exports = { createCustomBackgroundDiskStore };
