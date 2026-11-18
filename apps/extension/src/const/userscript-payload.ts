/**
 * 浏览器油猴脚本启动时优先运行已经下载好的新版小抄。
 * 打包脚本、发版脚本和小抄自己共用这些名字，改一处要三边一起生效。
 */

/** 新版代码的下载地址。只认这一个地址，清单里写别的地址不下载。 */
export const USERSCRIPT_PAYLOAD_URL = 'https://95chong.cn/api/xiaochao-userscript';

/** 新版代码的文件名：打包输出、发版目录、版本服务 data 目录都叫这个名字。 */
export const USERSCRIPT_PAYLOAD_FILE_NAME = 'xiaochao-userscript.js';

/** 新版代码第一行的开头，后面跟版本号，下载后核对是不是清单说的那一版。 */
export const USERSCRIPT_PAYLOAD_MARKER = '// xiaochao-payload ';

/** 存新版代码的本地数据库。 */
export const USERSCRIPT_PAYLOAD_DB_NAME = 'xiaochao-userscript';

/** 本地数据库的结构版本，改了存法才加一。 */
export const USERSCRIPT_PAYLOAD_DB_VERSION = 1;

/** 本地数据库里放新版代码的表。 */
export const USERSCRIPT_PAYLOAD_STORE_NAME = 'payload';

/** 表里只存一条记录，用这个键。 */
export const USERSCRIPT_PAYLOAD_RECORD_KEY = 'current';

/** 已经下好的新版版本号。启动时同步读，比脚本自带的新才去数据库取代码。 */
export const USERSCRIPT_PAYLOAD_VERSION_KEY = 'XC::userscript-payload-version';

/** 跑不起来的新版版本号。网站不让运行下载的代码时记下，之后这一版都用脚本自带的。 */
export const USERSCRIPT_PAYLOAD_BLOCKED_KEY = 'XC::userscript-payload-blocked';

/** 启动代码挂在页面上的状态。小抄看到它，才知道刷新后会运行下载好的新版。 */
export const USERSCRIPT_PAYLOAD_LOADER_GLOBAL = '__XIAOCHAO_PAYLOAD_LOADER__';

/** 小抄入口最先写的启动状态。新版报错时据此判断它有没有开始启动。 */
export const USERSCRIPT_STARTUP_GLOBAL = '__XIAOCHAO_STARTUP__';

/** 从本地数据库取代码最多等多久，超时就运行脚本自带的，单位毫秒。 */
export const USERSCRIPT_PAYLOAD_READ_TIMEOUT_MS = 3000;

/** 新版代码最大字节数，超过就当下载出错。 */
export const USERSCRIPT_PAYLOAD_MAX_BYTES = 8 * 1024 * 1024;

/** 下载失败以后，隔多久才再试，单位毫秒。 */
export const USERSCRIPT_PAYLOAD_RETRY_MS = 2 * 60 * 1000;
