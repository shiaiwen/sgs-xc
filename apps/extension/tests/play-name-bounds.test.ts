import assert from 'node:assert/strict';
import { readLabelScreenBounds } from '../src/features/ai-player/play-name-sync.ts';

const fakeStage = { width: 1920, height: 1080 };
const fakeWindow = {
  Laya: {
    Point: class {
      x: number;
      y: number;
      constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
      }
    },
    stage: fakeStage
  }
};

const onScreenLabel = {
  width: 100,
  height: 24,
  localToGlobal(point: { x: number; y: number }) {
    return { x: point.x + 100, y: point.y + 200 };
  }
};

const offScreenLabel = {
  width: 100,
  height: 24,
  localToGlobal(point: { x: number; y: number }) {
    return { x: point.x - 500, y: point.y - 500 };
  }
};

const orphanLabel = {
  width: 100,
  height: 24,
  parent: null
};

const on = readLabelScreenBounds(onScreenLabel, fakeWindow as Window);
const off = readLabelScreenBounds(offScreenLabel, fakeWindow as Window);
const orphan = readLabelScreenBounds(orphanLabel, fakeWindow as Window);
assert.equal(on?.onScreen, true);
assert.equal(off?.onScreen, false);
assert.equal(orphan, null);

console.log('play-name-bounds ok');
