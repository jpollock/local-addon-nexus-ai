#!/usr/bin/env bash
# Run all 10 cases in batches of 2 to avoid memory pressure
CONFIG="tests/evals/promptfoo/promptfooconfig.yaml"
for n in 2 4 6 8 10; do
  echo "▶ Running cases up to $n..."
  npx promptfoo eval -c "$CONFIG" --no-cache --max-concurrency 1 --filter-first-n $n
  echo "✓ Batch done. Pausing 10s..."
  sleep 10
done
echo "All done. Run: npx promptfoo view"
