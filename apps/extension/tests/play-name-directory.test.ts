import assert from 'node:assert/strict';
import {
  beginPlayNameScanBatch,
  endPlayNameScanBatch,
  seedPlayNameDirectory,
  syncSeatPlayName
} from '../src/features/ai-player/play-name-sync.ts';

const fakeWindow = {
  Laya: {
    Text: class {
      text = '';
      visible = true;
      name = 'xcSeatPlayName';
      width = 168;
      height = 26;
      x = 0;
      y = 0;
      zOrder = 0;
      fontSize = 18;
      align = 'center';
      _getBit() { return 0; }
      removeSelf() {}
      pos() {}
      repaint() {}
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

const gdsManager = {
  constructor: { name: 'gds' },
  playerNameTxt: null,
  SetPlayNameVisible() {},
  __xcPlayNameMount: 'none'
};

const avatar1 = {
  width: 120,
  addChild(child: unknown) {
    const node = child as { parent?: unknown };
    node.parent = avatar1;
  },
  localToGlobal(p: { x: number; y: number }) {
    return { x: p.x + 200, y: p.y + 200 };
  }
};

const seatUis = [
  {
    seat: { playerInfo: { ClientId: 1002, playerName: '乙昵称' } },
    otherTopManager: gdsManager,
    seatAvatar: avatar1
  }
];

beginPlayNameScanBatch(fakeWindow, { replayLike: false, forceFull: false });
seedPlayNameDirectory(fakeWindow, seatUis);
syncSeatPlayName(seatUis[0], fakeWindow, 0);
endPlayNameScanBatch();

const label = (gdsManager as { __xcPlayNameLabel?: { text?: string; visible?: boolean } }).__xcPlayNameLabel
  ?? (avatar1 as { __xcPlayNameLabel?: { text?: string; visible?: boolean } }).__xcPlayNameLabel;
assert.equal(label?.text, '乙昵称');
assert.equal(label?.visible, true);
assert.equal(gdsManager.__xcPlayNameMount, 'C');

console.log('play-name-directory ok');
