#!/usr/bin/env bash
# Stages the extension into dist/stage and zips it as dist/eve-extension.zip (used by CI and the install scripts).
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf dist && mkdir -p dist/stage
for f in CSXS host lib node ui prompts index.html VERSION; do cp -R "$f" dist/stage/; done
(cd dist/stage && zip -qr ../eve-extension.zip .)
echo "Built dist/eve-extension.zip for v$(cat VERSION)"
