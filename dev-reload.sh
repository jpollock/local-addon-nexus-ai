#!/bin/bash
set -e

echo "Killing Local..."
pkill -x "Local" 2>/dev/null || true
sleep 1

echo "Building..."
npm run build

echo "Rebuilding native modules..."
npm run rebuild

echo "Launching Local..."
open /Applications/Local.app
