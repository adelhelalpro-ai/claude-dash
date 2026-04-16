<p align="center">
  <img src="assets/hero-screenshot.png" width="320" alt="Claude Dash — Real-time usage monitor" />
</p>

<h1 align="center">Claude Dash</h1>

<p align="center">
  <strong>Know exactly when you'll hit the limit. Before you do.</strong>
</p>

<p align="center">
  <a href="#install">Install</a> &nbsp;&bull;&nbsp;
  <a href="#how-it-works">How it works</a> &nbsp;&bull;&nbsp;
  <a href="#features">Features</a> &nbsp;&bull;&nbsp;
  <a href="#build-from-source">Build</a> &nbsp;&bull;&nbsp;
  <a href="#support-this-project">Donate</a>
</p>

<p align="center">
  <a href="../../releases/latest"><img src="https://img.shields.io/github/v/release/AdelHelal/claude-dash?style=flat-square&color=8B5CF6&label=latest" alt="Latest Release" /></a>
  <a href="../../releases/latest"><img src="https://img.shields.io/github/downloads/AdelHelal/claude-dash/total?style=flat-square&color=22C55E&label=downloads" alt="Downloads" /></a>
  <a href="../../actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/AdelHelal/claude-dash/ci.yml?style=flat-square&label=tests" alt="CI" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blueviolet?style=flat-square" alt="Platform" />
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square" alt="Zero deps" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT License" /></a>
</p>

---

I kept getting rate-limited on Claude with zero visibility on when I'd hit the wall. No progress bar. No ETA. Just a sudden "you've reached your limit, come back later."

So I built this in one session. A tiny floating widget that reads your Claude usage in real-time, shows you exactly where you stand on every limit, and predicts when you'll run out based on your actual consumption speed.

Zero runtime dependencies. Zero config. Just install and it picks up your Claude Code session automatically.

---

## Install

Download the latest build for your platform:

<table>
  <tr>
    <td align="center"><strong>macOS</strong></td>
    <td align="center"><strong>Windows</strong></td>
    <td align="center"><strong>Linux</strong></td>
  </tr>
  <tr>
    <td align="center">
      <a href="../../releases/latest">
        <img src="https://img.shields.io/badge/Download-.dmg-blue?style=for-the-badge&logo=apple&logoColor=white" alt="macOS DMG" />
      </a>
      <br/><sub>Universal (Intel + Apple Silicon)</sub>
    </td>
    <td align="center">
      <a href="../../releases/latest">
        <img src="https://img.shields.io/badge/Download-.exe-blue?style=for-the-badge&logo=windows&logoColor=white" alt="Windows Installer" />
      </a>
      <br/><sub>x64 / ARM64</sub>
    </td>
    <td align="center">
      <a href="../../releases/latest">
        <img src="https://img.shields.io/badge/Download-.AppImage-blue?style=for-the-badge&logo=linux&logoColor=white" alt="Linux AppImage" />
      </a>
      <br/><sub>x64 / ARM64 &nbsp;·&nbsp; .deb also available</sub>
    </td>
  </tr>
</table>

> **Prerequisite:** [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and logged in. Claude Dash reads your existing session — no separate login needed.

## How it works

Claude Dash reads the OAuth tokens that Claude Code stores locally (`~/.claude/.credentials.json`), refreshes them silently, and polls the usage API every 5 minutes.

```
Claude Code login → ~/.claude/.credentials.json → Claude Dash reads tokens
                                                 → Polls /api/oauth/usage
                                                 → Displays limits + predictions
```

It shares tokens with Claude Code — both apps stay in sync. When you relaunch, it reconnects instantly without re-authentication.

## Features

**Real-time limit tracking**
- 5-hour rolling window utilization
- 7-day rolling window utilization
- Model-specific limits (Opus, Sonnet) when applicable
- Extra usage status and monthly cap

**Predictive ETA**
- Estimates time until you hit each limit
- Based on your consumption speed over the last 2 hours
- Adapts automatically as your usage pattern changes

**Compact always-on-top widget**
- 360 x 520px frameless floating window
- Dark glassmorphism with native macOS vibrancy
- Smooth number animations and color-coded progress bars
- Green to Yellow to Orange to Red as you approach limits

**Native notifications**
- macOS/Windows alerts at 80% and 95% thresholds
- De-duplicated per reset window (no spam)

**Zero friction**
- Auto-detects Claude Code credentials
- Auto-refreshes expired tokens
- Persists window position across restarts
- No config files, no setup wizard

## Tech

| | |
|---|---|
| **Runtime deps** | 0 |
| **Framework** | Electron 33 |
| **Renderer** | Vanilla HTML/CSS/JS |
| **Auth** | OAuth 2.0 PKCE (shared with Claude Code) |
| **Polling** | 5min interval, smart backoff + token rotation on 429 |
| **Storage** | Electron safeStorage (encrypted) |
| **Tests** | 38 Playwright E2E tests |
| **CI/CD** | GitHub Actions (macOS + Windows + Linux) |

## Build from source

```bash
git clone https://github.com/AdelHelal/claude-dash.git
cd claude-dash
npm install
npm start            # Run in dev mode
npm test             # Run 38 E2E tests
npm run dist         # Build for current platform
```

<details>
<summary><strong>Platform-specific builds</strong></summary>

```bash
# macOS DMG (Universal: Intel + Apple Silicon)
npx electron-builder --mac

# Windows NSIS installer (x64 + ARM64)
npx electron-builder --win

# Linux AppImage + .deb (x64)
npx electron-builder --linux
```

</details>

## Support this project

If Claude Dash saved you from rage-quitting a coding session, consider buying me a coffee:

| Network | Address |
|---------|---------|
| **BTC** | `bc1qqdlxs98e3fleely7dda39a0zg90k7uesgegnej` |
| **ETH** | `0xbCa8F43c5538Bc693E3cbe212D1D64C2c1b13e6B` |
| **SOL** | `B4FaXHEp5iv1bUUFR7PZMrUVy9aeeMEEa6WguutRQNJm` |
| **TRON** | `TYMiPoSGEfG58iCZgAVQoNdDygQN43fQhQ` |

## Work with me

I build tools that solve real problems. If you need someone who ships fast and thinks in systems, let's talk.

**[orbitalis.tech](https://www.orbitalis.tech)**

---

<p align="center">
  Built by <a href="https://www.orbitalis.tech">Adel Helal</a> &nbsp;&middot;&nbsp; MIT License
</p>
