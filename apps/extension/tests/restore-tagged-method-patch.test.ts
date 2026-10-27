import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMethodPatcher, restoreTaggedMethodPatch } from '../src/runtime/method-patch.ts';

describe('restoreTaggedMethodPatch', () => {
  it('无 patcher 时也能还原被包装的方法', () => {
    const target = {
      run() {
        return 'native';
      },
    };
    const patcher = createMethodPatcher();
    patcher.wrap(target, 'run', (original) => function () {
      return 'wrapped:' + original.call(this);
    });
    assert.equal(target.run(), 'wrapped:native');
    assert.equal(restoreTaggedMethodPatch(target, 'run'), true);
    assert.equal(target.run(), 'native');
  });
});
