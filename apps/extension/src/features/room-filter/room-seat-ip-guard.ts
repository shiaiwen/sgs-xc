/**
 * 房间「IP 相同」误报修正。
 *
 * 游戏换房或有人换座时，会把新玩家的资料拷进座位上原有的那份数据，但不拷 IP，
 * 补要 IP 时又只问「还没有 IP」的座位。于是旧主人的 IP 一直留在座位上，
 * 新坐进来的人就会被标成和旧主人 IP 相同。
 *
 * 这里在游戏每次拿到 IP 后记下这份 IP 属于谁；游戏补要 IP 之前，
 * 发现座位已换人就先清掉旧 IP，游戏随后会给这个座位重新要一次。
 *
 * 换房时游戏有时收不到自己离桌的回包，上一桌的座位不会被清掉，
 * 房间里就会出现两个自己，并互相标成 IP 相同。座位表回包有时只列一部分人，
 * 不能按「表里没有」删座位；只在同一个人同时占着两个座位时，
 * 保留这份回包里写的那个座位，另一个用游戏自己的删座位方法删掉。
 */

import { createLayaObjectLocator, type LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import {
  ROOM_SEAT_DUPLICATE_DROP_DELAY_MS,
  ROOM_SEAT_IP_GUARD_SCAN_MS,
} from '../../const/poll-intervals.ts';
import type { GameEventBus } from '../../runtime/game-event-bus.ts';
import { createMethodPatcher } from '../../runtime/method-patch.ts';
import { everyInterval } from '../../runtime/shared-ticker.ts';

type UnknownRecord = Record<string, unknown>;

const TABLE_USER_IP_INFO_EVENT = 'TABLE_USER_IP_INFO';
const TABLE_INFO_REP_EVENT = 'TABLE_INFO_REP_EVENT';
const TABLE_INFO_MESSAGE = 'ClientTableinfoRep';

export interface RoomSeatIpGuard {
  filterMessage(payload: UnknownRecord, className: string): void;
  dispose(): void;
}

export function installRoomSeatIpGuard(
  globalObject: Window = window,
  gameEvents?: GameEventBus
): RoomSeatIpGuard {
  const locator = createLayaObjectLocator(globalObject as unknown as LayaRuntimeWindow);
  const patcher = createMethodPatcher();
  const ipOwners = new WeakMap<object, unknown>();
  let roomManager: UnknownRecord | null = null;
  const listenerCaller = {};
  /** 最近一份座位表回包里每个人坐在哪个座位。游戏处理完这份回包后用掉。 */
  let pendingSeatByClient: Map<string, number> | null = null;

  function seatInfos(manager: UnknownRecord): UnknownRecord[] {
    const datum = asRecord(manager.tabbleSeatInfos)?.datum;
    if (!Array.isArray(datum)) return [];
    return datum.map(asRecord).filter((seat): seat is UnknownRecord => seat !== null);
  }

  function rememberIpOwners(): void {
    if (!roomManager) return;
    for (const seat of seatInfos(roomManager)) {
      if (seat.Md5Ip) ipOwners.set(seat, seat.ClientId);
    }
  }

  /** 座位换了人还留着旧 IP 的，清掉。返回是否清过。 */
  function clearStaleIps(manager: UnknownRecord): boolean {
    let cleared = false;
    for (const seat of seatInfos(manager)) {
      if (!seat.Md5Ip || !ipOwners.has(seat)) continue;
      if (ipOwners.get(seat) === seat.ClientId) continue;
      seat.Md5Ip = '';
      seat.IsSameIp = false;
      ipOwners.delete(seat);
      cleared = true;
    }
    return cleared;
  }

  function filterMessage(payload: UnknownRecord, className: string): void {
    if (className !== TABLE_INFO_MESSAGE) return;
    const body = asRecord(payload.Protocol) ?? payload;
    const infos = body.Infos;
    if (!Array.isArray(infos) || !infos.length) {
      pendingSeatByClient = null;
      return;
    }
    const seatByClient = new Map<string, number>();
    for (const info of infos) {
      const record = asRecord(info);
      const clientId = clientKey(record?.ClientId);
      const seatId = Number(record?.SeatID);
      if (clientId && Number.isInteger(seatId)) seatByClient.set(clientId, seatId);
    }
    pendingSeatByClient = seatByClient.size ? seatByClient : null;
  }

  function runDuplicateSeatDrop(
    manager: UnknownRecord,
    seatByClient: Map<string, number>
  ): void {
    if (typeof manager.delSeatInfo !== 'function') return;
    const stale = seatInfos(manager)
      .filter((seat) => {
        const clientId = clientKey(seat.ClientId);
        const currentSeat = clientId ? seatByClient.get(clientId) : undefined;
        return currentSeat !== undefined && Number(seat.SeatID) !== currentSeat;
      })
      .map((seat) => Number(seat.SeatID))
      .filter((seatId) => Number.isInteger(seatId));
    for (const seatId of stale) {
      try {
        (manager.delSeatInfo as (seatId: number) => void).call(manager, seatId);
      } catch (error) {
        console.warn('[小抄] 删除上一桌留下的座位失败', seatId, error);
      }
    }
  }

  /** 同一个人还占着回包里没写的另一个座位，那是上一桌留下的，删掉。稍延后执行，避免卡在进房加载。 */
  function dropDuplicateSeats(): void {
    const manager = roomManager;
    const seatByClient = pendingSeatByClient;
    pendingSeatByClient = null;
    if (!manager || !seatByClient) return;
    const capturedManager = manager;
    const capturedMap = new Map(seatByClient);
    const laya = asRecord((globalObject as LayaRuntimeWindow).Laya);
    const timer = laya?.timer as { once?: (delay: number, caller: unknown, handler: () => void) => void } | undefined;
    if (typeof timer?.once === 'function') {
      timer.once(ROOM_SEAT_DUPLICATE_DROP_DELAY_MS, null, () => {
        if (roomManager !== capturedManager) return;
        runDuplicateSeatDrop(capturedManager, capturedMap);
      });
      return;
    }
    globalObject.setTimeout(() => {
      if (roomManager !== capturedManager) return;
      runDuplicateSeatDrop(capturedManager, capturedMap);
    }, ROOM_SEAT_DUPLICATE_DROP_DELAY_MS);
  }

  function isRoomManager(manager: UnknownRecord): boolean {
    return typeof manager.checkIP === 'function'
      && typeof manager.resetIPStatus === 'function'
      && asRecord(manager.tabbleSeatInfos) !== null;
  }

  function attach(manager: UnknownRecord): void {
    if (manager === roomManager) return;
    detach();
    roomManager = manager;
    if (typeof manager.on === 'function') {
      const on = manager.on as (type: string, caller: object, listener: () => void) => void;
      on.call(manager, TABLE_USER_IP_INFO_EVENT, listenerCaller, rememberIpOwners);
      on.call(manager, TABLE_INFO_REP_EVENT, listenerCaller, dropDuplicateSeats);
    }
    rememberIpOwners();
    patcher.wrap(manager, 'checkIP', (original) => function (this: UnknownRecord, ...args: unknown[]) {
      try {
        if (clearStaleIps(this)) (this.resetIPStatus as () => void).call(this);
      } catch (error) {
        console.warn('[小抄] 清理座位旧 IP 失败', error);
      }
      return original.apply(this, args);
    });
  }

  function detach(): void {
    const manager = roomManager;
    roomManager = null;
    patcher.restoreAll();
    if (manager && typeof manager.off === 'function') {
      try {
        const off = manager.off as (type: string, caller: object, listener: () => void) => void;
        off.call(manager, TABLE_USER_IP_INFO_EVENT, listenerCaller, rememberIpOwners);
        off.call(manager, TABLE_INFO_REP_EVENT, listenerCaller, dropDuplicateSeats);
      } catch {
        // 管理器已销毁时不用再解绑。
      }
    }
  }

  function scan(): void {
    try {
      const manager = locator.managerFromList(isRoomManager);
      if (manager) attach(manager);
    } catch (error) {
      console.warn('[小抄] 查找房间座位管理器失败', error);
    }
  }

  scan();
  let stopScanning: (() => void) | null = null;
  const ensureScanning = () => {
    if (stopScanning) return;
    stopScanning = everyInterval('房间座位IP', ROOM_SEAT_IP_GUARD_SCAN_MS, () => {
      scan();
      // 找到并接管房间座位管理器后停掉轮询；进房后的座位变化由事件监听驱动。
      if (roomManager) {
        stopScanning?.();
        stopScanning = null;
      }
    });
  };
  ensureScanning();
  const stopGameEvents = gameEvents?.subscribe((event) => {
    if (event.type !== 'game-ended') return;
    pendingSeatByClient = null;
    // 局后可能回大厅或换房，重新扫一次房间座位管理器。
    detach();
    ensureScanning();
  }) ?? (() => {});

  return {
    filterMessage,
    dispose() {
      stopGameEvents();
      stopScanning?.();
      detach();
    }
  };
}

function clientKey(value: unknown): string {
  if (value === null || value === undefined || value === '' || value === 0) return '';
  return String(value);
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}
