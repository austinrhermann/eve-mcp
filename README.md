# Eve

A chat-room style Claude panel for After Effects. Eve runs your own Claude Code or Codex and gives it tools to read and edit your After Effects project. macOS and Windows.

## Before you start
1. Install [Claude Code](https://claude.com/claude-code) and run `claude` once to sign in, or install Codex (`npm i -g @openai/codex`) and run `codex login`. Pick the provider in Settings.
2. After Effects > Settings > Scripting & Expressions: tick **Allow Scripts to Write Files and Access Network**.
3. Save your project (Eve works next to the .aep for checkpoints and project skills).

## Install (pick one)
**A. Eve.zxp (easiest, no Terminal).** Download `Eve.zxp` from the latest [Release](../../releases/latest), install with the free [ZXP Installer](https://aescripts.com/learn/zxp-installer/) (drag it in on Mac, double-click on Windows), then restart After Effects.

**B. One line.**
- macOS (Terminal): `curl -fsSL https://raw.githubusercontent.com/OWNER/eve/main/scripts/install-mac.sh | bash`
- Windows (PowerShell): `irm https://raw.githubusercontent.com/OWNER/eve/main/scripts/install-win.ps1 | iex`

Then open **Window > Extensions > Eve** (newer builds: **Extensions (Legacy) > Eve**).

## Update
Do the same thing again. Both methods replace the old version and keep your settings and chats. The panel shows its version in Settings. Use one install method only, not both.

## For maintainers
- Bump: `bash scripts/bump.sh patch|minor|major`, commit, tag `vX.Y.Z`, push the tag. GitHub Actions builds `Eve.zxp` and `eve-extension.zip`.
- Local install from a checkout: `bash scripts/install-mac.sh` (add `--link` while developing) or double-click `scripts\install-win.bat`.
- Before publishing, replace `OWNER/eve` in the README and `scripts/` with your repo (or set `EVE_REPO`).
- Data (settings, chats, attachments): macOS `~/Library/Application Support/eve`, Windows `%APPDATA%\eve`.
- Eve's tools run on a local server (127.0.0.1, random port, bearer token). Remote debugging: http://localhost:8099.
- If your own AE MCP is also registered in Claude Code, switch off "Also load my other MCP servers" in Settings.

## Providers
- Claude Code: full feature set.
- Codex: runs `codex exec` once per message. Branching is not available, and M (manual) only asks before scripts because Codex cannot prompt in headless mode. Security modes map to Codex sandboxes (Adobe Only = read-only, Project Folder = workspace-write, Full Access = no sandbox). Skills live in `~/.agents/skills`.
