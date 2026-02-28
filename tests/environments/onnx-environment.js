/**
 * Custom Jest environment for tests that use onnxruntime-node.
 *
 * onnxruntime-node's native addon creates typed arrays (Float32Array, etc.)
 * using the outer V8 context's constructors.  Jest's node environment runs
 * test code in a vm.Context sandbox whose constructors are *different objects*,
 * so `data instanceof Float32Array` fails inside onnxruntime-common when it
 * creates output tensors.
 *
 * This environment replaces the sandbox's typed-array constructors with the
 * real (outer-context) ones so the instanceof checks pass.
 */
const NodeEnvironment = require('jest-environment-node').TestEnvironment;

class OnnxTestEnvironment extends NodeEnvironment {
  async setup() {
    await super.setup();

    // Patch typed-array globals so native addon output passes instanceof checks
    this.global.Float32Array = Float32Array;
    this.global.Float64Array = Float64Array;
    this.global.Int8Array = Int8Array;
    this.global.Int16Array = Int16Array;
    this.global.Int32Array = Int32Array;
    this.global.Uint8Array = Uint8Array;
    this.global.Uint16Array = Uint16Array;
    this.global.Uint32Array = Uint32Array;
    this.global.BigInt64Array = BigInt64Array;
    this.global.BigUint64Array = BigUint64Array;
    this.global.ArrayBuffer = ArrayBuffer;
    this.global.SharedArrayBuffer = SharedArrayBuffer;
    this.global.DataView = DataView;
  }
}

module.exports = OnnxTestEnvironment;
