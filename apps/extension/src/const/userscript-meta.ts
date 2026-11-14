/** 油猴脚本的命名空间，正式包和本地开发加载器共用。 */
export const USERSCRIPT_NAMESPACE = 'https://95chong.cn/';

/** 油猴脚本要注入的游戏页面。 */
export const USERSCRIPT_MATCHES = [
  '*://game.4399iw2.com/yxsgs/*',
  '*://my.4399.com/yxsgs/*',
  '*://*.sanguosha.com/*',
  '*://web.kuaiwan.com/kwsgsn/*',
  '*://wan.baidu.com/microend?gameId=19793595*',
  '*://www.7k7k.com/special/sgs/?*',
  '*://playgame.iqiyi.com/login/iframe_page_web/top?game_id=146'
];

/** 上面范围里不注入的页面，例如小游戏、别的版本的三国杀。 */
export const USERSCRIPT_EXCLUDES = [
  'https://game.4399iw2.com/yxxsgs/*',
  '*://*.sanguosha.com/10/*',
  '*://*.sanguosha.com/10th/*',
  '*://*.sanguosha.com/220/miniGame/*',
  'https://wan.baidu.com/*gameId=19793616*',
  '*://h5.7k7k.com/web/H5GAMES.html?gid=960982bec2f555de44ea43ca8a7ef418/*',
  '*://qqgame.qq.com/webappframe/?appid=10951',
  '*://s118.app1107877410.qqopenapp.com/pc/qqLobby_index.php*'
];

/** 本地开发加载器在油猴里的名字，和打包出来的开发版脚本区分开。 */
export const USERSCRIPT_DEV_LOADER_NAME = 'dev:三国杀小抄-本地加载';

/** 本地开发加载器的安装路径。 */
export const USERSCRIPT_DEV_LOADER_PATH = '/xiaochao-dev-loader.user.js';
