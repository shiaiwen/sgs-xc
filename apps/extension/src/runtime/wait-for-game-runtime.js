/**
 * 检查游戏页面是否具备初始化小抄所需的全局对象和根节点。
 * PUERTS 模式使用另一套资源加载机制，因此无需等待浏览器版依赖。
 *
 * 参数允许注入 window/document 替身，使这段逻辑无需启动游戏即可测试。
 *
 * @param {{globalObject?: object, documentObject?: object}} [environment]
 * @returns {string[]} 尚未就绪的依赖名称；空数组表示可以初始化。
 */
export function getMissingGameRuntimeDependencies({
  globalObject = globalThis,
  documentObject = globalObject.document
} = {}) {
  if (globalObject.PUERTS_JS_RESOURCES !== undefined) return [];

  const missing = [];
  // 没有游戏运行时就先不挂面板，官网和登录页不该先出小抄。
  if (globalObject.SystemContext === undefined) missing.push('SystemContext');
  return missing;
}

/**
 * 轮询等待游戏运行时，并保证初始化函数最多执行一次。
 *
 * 状态变化顺序：waiting → initializing → ready/failed；如果页面提前销毁，
 * 则从 waiting 进入 cancelled。所有定时器都会通过生命周期回调释放。
 *
 * @param {object} options
 * @param {() => string[]} options.probe 返回当前缺失依赖。
 * @param {() => unknown|Promise<unknown>} options.initialize 依赖就绪后的初始化过程。
 * @param {(cleanup: Function) => void} options.registerCleanup 注册页面销毁回调。
 * @param {object} options.status 暴露给开发监控的可变状态对象。
 * @param {object} [options.timers] 可替换的计时器实现，主要用于测试。
 * @param {number} [options.intervalMs=1000] 探测间隔。
 * @returns {Promise<unknown>} 初始化结果；等待期间被清理时返回 false。
 */
export function waitForGameRuntime({
  probe,
  initialize,
  registerCleanup,
  status,
  timers = globalThis,
  intervalMs = 1000
}) {
  status.state = 'waiting';
  status.missing = [];

  return new Promise((resolve, reject) => {
    let finished = false;
    let interval;

    // clearInterval 只允许执行一次，避免初始化、异常、销毁路径互相干扰。
    const stopPolling = () => {
      if (interval !== undefined) timers.clearInterval(interval);
      interval = undefined;
    };

    const fail = (error) => {
      finished = true;
      stopPolling();
      status.state = 'failed';
      status.error = String(error?.message || error);
      reject(error);
    };

    const check = () => {
      if (finished) return;
      try {
        status.missing = probe();
        if (status.missing.length) return;
        finished = true;
        stopPolling();
        status.state = 'initializing';
        Promise.resolve()
          .then(initialize)
          .then((result) => {
            status.state = result === false ? 'failed' : 'ready';
            resolve(result);
          }, fail);
      } catch (error) {
        fail(error);
      }
    };

    // 页面刷新或插件主动销毁时，必须终止仍在等待的 Promise。
    registerCleanup(() => {
      stopPolling();
      if (!finished) {
        finished = true;
        status.state = 'cancelled';
        resolve(false);
      }
    });

    if (!finished) {
      interval = timers.setInterval(check, intervalMs);
      check();
    }
  });
}

/**
 * 将运行时能力安装到统一的全局桥接对象。
 *
 * @param {object} [globalObject=globalThis] 通常为游戏页面的 window。
 * @param {object} [additions] 生命周期等其他已迁移能力。
 * @returns {object} 安装后的桥接对象。
 */
export function installRuntimeBridge(globalObject = globalThis, additions = {}) {
  const bridge = globalObject.__XIAOCHAO_ENGINEERING__ || {};
  Object.assign(bridge, {
    getMissingGameRuntimeDependencies,
    waitForGameRuntime,
    ...additions
  });
  globalObject.__XIAOCHAO_ENGINEERING__ = bridge;
  return bridge;
}
