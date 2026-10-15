import assert from 'node:assert/strict';
import {
  beginPlayNameScanBatch,
  endPlayNameScanBatch,
  syncSeatPlayName
} from '../src/features/ai-player/play-name-sync.ts';

const fakeWindow = {
  Laya: {
    Text: class {
      text = '';
      visible = true;
      name = '';
      width = 120;
      height = 24;
      x = 0;
      y = 0;
      zOrder = 0;
      addChild() {}
      pos() {}
    },
    Point: class {
      x: number;
      y: number;
      constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
      }
    },
    stage: { width: 1920, height: 1080 }
  },
  __xcPlayNameDebug: { verbose: false, pauseSync: false, forceFullSync: false }
} as unknown as Window;

let setVisibleCalls = 0;
let setPlayerInfoCalls = 0;

const manager = {
  constructor: { name: 'gds' },
  playerNameTxt: null,
  SetPlayNameVisible() {
    setVisibleCalls += 1;
  },
  SetPlayerInfo() {
    setPlayerInfoCalls += 1;
  }
};

const avatar = {
  width: 120,
  addChild(child: unknown) {
    const label = child as { parent?: unknown };
    label.parent = avatar;
  },
  localToGlobal(point: { x: number; y: number }) {
    return { x: point.x + 400, y: point.y + 300 };
  }
};

const seatUi = {
  seat: { playerInfo: { ClientId: 1814942467 } },
  otherTopManager: manager,
  seatAvatar: avatar
};

beginPlayNameScanBatch(fakeWindow, { replayLike: true, forceFull: false });
syncSeatPlayName(seatUi, fakeWindow, 1);
endPlayNameScanBatch();

assert.ok(setVisibleCalls >= 1);
assert.equal(setPlayerInfoCalls, 0);

console.log('play-name-sync-replay ok');
