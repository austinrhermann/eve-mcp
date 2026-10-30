#!/usr/bin/env bash
# Eve installer / updater for macOS.
#   From a downloaded folder:  bash scripts/install-mac.sh          (add --link for a dev symlink)
#   Straight from GitHub:      curl -fsSL https://raw.githubusercontent.com/OWNER/eve/main/scripts/install-mac.sh | bash
set -euo pipefail
REPO="${EVE_REPO:-OWNER/eve}"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/com.austin.eve"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
SRC=""
if [ -n "$HERE" ] && [ -f "$HERE/../CSXS/manifest.xml" ]; then SRC="$(cd "$HERE/.." && pwd)"; fi

if [ -z "$SRC" ]; then
  echo "Downloading the latest Eve from GitHub..."
  TMP="$(mktemp -d)"
  curl -fsSL "https://github.com/$REPO/releases/latest/download/eve-extension.zip" -o "$TMP/eve.zip"
  mkdir -p "$TMP/eve" && unzip -oq "$TMP/eve.zip" -d "$TMP/eve"
  SRC="$TMP/eve"
fi

NEW="$(cat "$SRC/VERSION")"
OLD="none"; [ -f "$DEST/VERSION" ] && OLD="$(cat "$DEST/VERSION")"

if [ -d "$SRC/scripts" ]; then  # local checkout: keep the manifest in sync with VERSION
  perl -pi -e "s/(ExtensionBundleVersion=\")[^\"]*/\${1}$NEW/; s/(<Extension Id=\"com.austin.eve.panel\" Version=\")[^\"]*/\${1}$NEW/" "$SRC/CSXS/manifest.xml"
fi

for v in 9 10 11 12; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1; done
killall cfprefsd 2>/dev/null || true

mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
if [ "${1:-}" = "--link" ] && [ -d "$SRC/scripts" ]; then
  ln -s "$SRC" "$DEST"; MODE="linked to $SRC"
else
  mkdir -p "$DEST"
  rsync -a --exclude 'scripts' --exclude '.github' --exclude '.git' --exclude '.debug' --exclude 'README.md' --exclude 'dist' "$SRC/" "$DEST/"
  xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
  MODE="copied"
fi

zsh -lic 'command -v claude' >/dev/null 2>&1 || echo "! Claude Code not found. Install it, then run 'claude' once to sign in."
echo "Eve $OLD -> $NEW ($MODE)."
echo "Quit and reopen After Effects, then open Window > Extensions > Eve (or Extensions (Legacy) > Eve)."
