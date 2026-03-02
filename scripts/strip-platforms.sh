#!/usr/bin/env bash
#
# strip-platforms.sh — Remove non-target platform binaries to shrink addon size.
#
# Usage:
#   scripts/strip-platforms.sh <platform> <arch> [project-dir]
#
# Examples:
#   scripts/strip-platforms.sh darwin arm64
#   scripts/strip-platforms.sh linux x64 ./staging
#   scripts/strip-platforms.sh win32 x64
#
# Supported platforms: darwin, linux, win32
# Supported architectures: arm64, x64

set -euo pipefail

PLATFORM="${1:-}"
ARCH="${2:-}"
PROJECT_DIR="${3:-.}"

if [[ -z "$PLATFORM" || -z "$ARCH" ]]; then
  echo "Usage: $0 <platform> <arch> [project-dir]"
  echo "  platform: darwin | linux | win32"
  echo "  arch:     arm64 | x64"
  exit 1
fi

NODE_MODULES="$PROJECT_DIR/node_modules"

if [[ ! -d "$NODE_MODULES" ]]; then
  echo "Error: node_modules not found at $NODE_MODULES"
  exit 1
fi

BEFORE_SIZE=$(du -sm "$NODE_MODULES" 2>/dev/null | awk '{print $1}' || echo "?")

echo "Stripping non-target platforms (keeping $PLATFORM-$ARCH)..."

# ---------------------------------------------------------------------------
# 1. ONNX Runtime: remove non-target platform directories
# ---------------------------------------------------------------------------
ONNX_BIN_DIR="$NODE_MODULES/onnxruntime-node/bin/napi-v6"

if [[ -d "$ONNX_BIN_DIR" ]]; then
  echo "  ONNX Runtime: scanning $ONNX_BIN_DIR"

  for dir in "$ONNX_BIN_DIR"/*/; do
    [[ ! -d "$dir" ]] && continue
    dirname=$(basename "$dir")

    # Keep only the matching platform directory
    # Directories are named like: darwin/arm64, darwin/x64, linux/x64, win32/x64
    # They may also be flat: just the platform name containing arch subdirs
    keep=false

    case "$dirname" in
      "$PLATFORM")
        # Platform dir — check if arch subdir exists and strip non-matching
        if [[ -d "$dir/$ARCH" ]]; then
          # Remove other arch subdirs
          for archdir in "$dir"/*/; do
            [[ ! -d "$archdir" ]] && continue
            archname=$(basename "$archdir")
            if [[ "$archname" != "$ARCH" ]]; then
              echo "    Removing $dirname/$archname"
              rm -rf "$archdir"
            fi
          done
          keep=true
        else
          keep=true  # Keep platform dir if it has files directly
        fi
        ;;
      *)
        echo "    Removing platform dir: $dirname"
        rm -rf "$dir"
        ;;
    esac
  done
else
  echo "  ONNX Runtime: bin directory not found, skipping"
fi

# ---------------------------------------------------------------------------
# 2. LanceDB: remove non-target platform packages
# ---------------------------------------------------------------------------
LANCEDB_DIR="$NODE_MODULES/@lancedb"

if [[ -d "$LANCEDB_DIR" ]]; then
  echo "  LanceDB: scanning $LANCEDB_DIR"

  # Map platform/arch to LanceDB package naming convention
  # e.g., @lancedb/lancedb-darwin-arm64, @lancedb/lancedb-linux-x64-gnu
  TARGET_PREFIX="lancedb-${PLATFORM}-${ARCH}"

  for pkg in "$LANCEDB_DIR"/lancedb-*/; do
    [[ ! -d "$pkg" ]] && continue
    pkgname=$(basename "$pkg")

    # Keep the main lancedb package and the target platform package
    if [[ "$pkgname" == "lancedb" ]]; then
      continue
    fi

    if [[ "$pkgname" == "$TARGET_PREFIX"* ]]; then
      echo "    Keeping: $pkgname"
    else
      echo "    Removing: $pkgname"
      rm -rf "$pkg"
    fi
  done
else
  echo "  LanceDB: @lancedb directory not found, skipping"
fi

# ---------------------------------------------------------------------------
# Report savings
# ---------------------------------------------------------------------------
AFTER_SIZE=$(du -sm "$NODE_MODULES" 2>/dev/null | awk '{print $1}' || echo "?")
echo ""
echo "Done! node_modules: ${BEFORE_SIZE} MB → ${AFTER_SIZE} MB"

if [[ "$BEFORE_SIZE" != "?" && "$AFTER_SIZE" != "?" ]]; then
  SAVED=$((BEFORE_SIZE - AFTER_SIZE))
  echo "Saved approximately ${SAVED} MB"
fi
