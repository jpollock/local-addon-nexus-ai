const Sequencer = require('@jest/test-sequencer').default;

/**
 * Runs test files in alphabetical order (by filename).
 * Files are numbered 01-11 so they execute in dependency order.
 */
class OrderedSequencer extends Sequencer {
  sort(tests) {
    return [...tests].sort((a, b) => a.path.localeCompare(b.path));
  }
}

module.exports = OrderedSequencer;
