#!/usr/bin/env bash
# Usage: bash scripts/bump.sh [patch|minor|major]   -> bumps VERSION and the manifest
set -euo pipefail
cd "$(dirname "$0")/.."
IFS=. read -r MA MI PA < VERSION
case "${1:-patch}" in major) MA=$((MA+1)); MI=0; PA=0;; minor) MI=$((MI+1)); PA=0;; *) PA=$((PA+1));; esac
echo "$MA.$MI.$PA" > VERSION
perl -pi -e "s/(ExtensionBundleVersion=\")[^\"]*/\${1}$MA.$MI.$PA/; s/(<Extension Id=\"com.austin.eve.panel\" Version=\")[^\"]*/\${1}$MA.$MI.$PA/" CSXS/manifest.xml
echo "Version is now $MA.$MI.$PA"
