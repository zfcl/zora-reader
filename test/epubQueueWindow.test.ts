import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

interface TestQueue {
  enqueue(task: () => void): Promise<unknown>;
}

interface TestQueueConstructor {
  new (context: unknown): TestQueue;
}

const require = createRequire(import.meta.url);
const Queue = (require('../node_modules/epubjs/lib/utils/queue.js') as { default: TestQueueConstructor }).default;

test('epub queue continues when a popout document is reported as hidden', async () => {
  let pageTurned = false;
  let frameRequests = 0;
  const popoutDocument = {
    hidden: true,
    defaultView: {
      requestAnimationFrame: () => {
        frameRequests += 1;
        return 1;
      },
    },
  };
  const queue = new Queue({
    manager: {
      container: {
        ownerDocument: popoutDocument,
      },
    },
  });

  await queue.enqueue(() => {
    pageTurned = true;
  });

  assert.equal(pageTurned, true);
  assert.equal(frameRequests, 0);
});

test('epub queue uses the actual popout animation frame while it is visible', async () => {
  let pageTurned = false;
  let frameRequests = 0;
  const popoutDocument = {
    hidden: false,
    defaultView: {
      requestAnimationFrame: (callback: () => void) => {
        frameRequests += 1;
        callback();
        return 1;
      },
    },
  };
  const queue = new Queue({
    manager: {
      container: {
        ownerDocument: popoutDocument,
      },
    },
  });

  await queue.enqueue(() => {
    pageTurned = true;
  });

  assert.equal(pageTurned, true);
  assert.ok(frameRequests > 0);
});
