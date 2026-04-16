# Claude Dash - Specification

## Overview
Compact Electron widget that monitors Claude usage limits in real-time. Connects via Claude OAuth (same as Claude Code), displays plan limits (5-hour, 7-day, Opus), estimates time-to-limit based on consumption rate, and sends native notifications at critical thresholds.

## Architecture

### Auth Flow (OAuth 2.0 PKCE)
- **Client ID**: `9d1c250a-e61b-44d9-88ed-5944d1962f5e` (Claude Code public client)
- **Authorization URL**: `https://claude.ai/oauth/authorize`
- **Token URL**: `https://console.anthropic.com/api/oauth/token`
- **Scopes**: `user:inference user:profile`
- **Flow**: PKCE (S256) with local HTTP callback server on random port
- **Token Storage**: Electron `safeStorage` (encrypted) with JSON fallback
- **Token Refresh**: Auto-refresh 5 min before expiry (8h access token lifetime)
- **Persistence**: Tokens survive app restart, auto-refresh on launch

### Usage Endpoint
- **URL**: `GET https://api.anthropic.com/api/oauth/usage`
- **Headers**: `Authorization: Bearer <token>`, `anthropic-beta: oauth-2025-04-20`
- **Response**:
  ```json
  {
    "five_hour":       { "utilization": 37.0, "resets_at": "ISO8601" },
    "seven_day":       { "utilization": 26.0, "resets_at": "ISO8601" },
    "seven_day_opus":  null | { "utilization": N, "resets_at": "ISO8601" },
    "extra_usage":     { "is_enabled": false, "monthly_limit": null }
  }
  ```
- **Polling**: Every 30s, exponential backoff on error (max 5min)

### Prediction Algorithm
- **Window**: Rolling 2-hour sliding window of utilization samples
- **Fallback**: All available history if < 2 data points in 2h window
- **Formula**: `timeToLimit = (100 - currentUtilization) / ratePerMs`
- **Rate**: `(newest.utilization - oldest.utilization) / (newest.timestamp - oldest.timestamp)`
- **Edge cases**: Reset detection (utilization drops), zero consumption, at-limit
- **History retention**: 24 hours, pruned on each poll

### Notifications
- Native OS notifications (Electron `Notification` API)
- Thresholds: 80% and 95% per limit window
- De-duplicated per reset window (won't re-fire until window resets)

## UI Specification

### Window
- **Size**: 360x520px, frameless, transparent, always-on-top
- **macOS**: Native vibrancy (`under-window`)
- **Windows**: CSS `backdrop-filter: blur(40px)`
- **Draggable**: Custom title bar with `-webkit-app-region: drag`
- **Position**: Persisted across restarts

### Design: Dark Glassmorphism
- **Background**: `rgba(15, 10, 30, 0.92)` + blur
- **Cards**: `rgba(255, 255, 255, 0.06)` with subtle border
- **Accent**: Claude purple `#8B5CF6`
- **Progress colors**: Green (#22C55E) -> Yellow (#EAB308) -> Orange (#F97316) -> Red (#EF4444)
- **Typography**: System font stack (SF Pro / Segoe UI)
- **Animations**: Smooth number transitions, progress bar easing, card hover glow

### Screens
1. **Login**: Logo + "Connect to Claude" button + loading state
2. **Dashboard**: Title bar + user info + limit cards + footer
3. **Error**: Contextual error messages with retry

### Limit Card (per active limit)
- Label (5-Hour / 7-Day / Opus 7-Day)
- Progress bar (color-interpolated, glowing)
- Percentage (animated number)
- Reset time ("Resets in 2h 34m")
- Estimation ("~1h 12m at current pace")
- Rate badge ("5.2%/h")

## Tech Stack
- Electron 33+ (cross-platform: macOS + Windows)
- Pure JavaScript (no framework, no bundler)
- Zero runtime dependencies
- HTML/CSS/JS renderer with glassmorphism
- Electron safeStorage for credential encryption

## File Structure
```
claude-dash/
├── package.json
├── .gitignore
├── SPEC.md
├── src/
│   ├── main/
│   │   ├── index.js        # Main process, window, IPC
│   │   ├── auth.js          # OAuth PKCE flow
│   │   ├── usage.js         # Polling, prediction, notifications
│   │   └── store.js         # Encrypted + plain storage
│   ├── preload.js           # Context bridge
│   └── renderer/
│       ├── index.html       # App shell (login + dashboard)
│       ├── styles.css       # Glassmorphism theme
│       └── app.js           # UI state machine + rendering
└── assets/
    └── icon.png
```

## PR Breakdown
1. **PR1**: Project scaffolding (package.json, .gitignore, directory structure)
2. **PR2**: Electron shell + store + preload (window creation, IPC skeleton)
3. **PR3**: OAuth PKCE authentication (auth.js, login UI, token persistence)
4. **PR4**: Usage polling + prediction engine (usage.js, history, estimation)
5. **PR5**: Glassmorphism dashboard UI (styles.css, app.js, limit cards)
6. **PR6**: Notifications + polish (alerts, auto-reconnect, error handling)
