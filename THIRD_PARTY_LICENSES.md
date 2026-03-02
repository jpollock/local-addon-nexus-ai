# Third-Party Licenses

## Runtime Dependencies

| Package | Version | License | URL |
|---------|---------|---------|-----|
| @lancedb/lancedb | ^0.13.0 | Apache-2.0 | https://github.com/lancedb/lancedb |
| onnxruntime-node | ^1.20.0 | MIT | https://github.com/microsoft/onnxruntime |
| apache-arrow | >=13.0.0 | Apache-2.0 | https://github.com/apache/arrow |
| mysql2 | ^3.11.0 | MIT | https://github.com/sidorares/node-mysql2 |
| zod | ^3.22.4 | MIT | https://github.com/colinhacks/zod |

## Bundled Model

| Model | License | URL |
|-------|---------|-----|
| all-MiniLM-L6-v2 | Apache-2.0 | https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2 |

The quantized ONNX model is downloaded at build time from Hugging Face and included in the distribution package.

## Development Dependencies

| Package | License |
|---------|---------|
| TypeScript | Apache-2.0 |
| Jest | MIT |
| ts-jest | MIT |
| ESLint | MIT |
| @types/* | MIT |

## License Texts

### Apache License 2.0

Applies to: @lancedb/lancedb, apache-arrow, all-MiniLM-L6-v2, TypeScript

Full text: https://www.apache.org/licenses/LICENSE-2.0

### MIT License

Applies to: onnxruntime-node, mysql2, zod, Jest, ts-jest, ESLint

Full text: https://opensource.org/licenses/MIT
