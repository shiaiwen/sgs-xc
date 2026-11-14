/** 正式包读写账号配置的地址。 */
export const ACCOUNT_CONFIG_REMOTE_URL = 'https://95chong.cn/api/account-config';

/** 本机开发服务。npm run dev 打出来的包用这个地址。 */
export const ACCOUNT_CONFIG_LOCAL_URL = 'http://127.0.0.1:8787/api/account-config';

/** 开关和小抄背景存在这个路径。 */
export const ACCOUNT_CONFIG_PATH = '/api/account-config';

/** 皮肤解锁里选好的皮肤存在这个路径，和账号配置在同一个服务上。 */
export const ACCOUNT_SKINS_PATH = '/api/account-skins';

/** 重置小抄时，当前账号存在服务器上的开关、背景和皮肤选择从这里清掉。 */
export const ACCOUNT_RESET_PATH = '/api/account-reset';
