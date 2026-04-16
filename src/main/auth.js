const crypto = require('crypto');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { shell } = require('electron');

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const AUTH_URL = 'https://claude.ai/oauth/authorize';
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const CREDENTIALS_PATH = path.join(os.homedir(), '.claude', '.credentials.json');

class AuthManager {
  constructor(store) {
    this.store = store;
    this.refreshTimer = null;
  }

  // ── Credentials file (shared with Claude Code) ──────

  _readClaudeCredentials() {
    try {
      const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
      return JSON.parse(raw).claudeAiOauth || null;
    } catch {
      return null;
    }
  }

  _writeClaudeCredentials(oauth) {
    try {
      let creds = {};
      try { creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8')); } catch {}
      creds.claudeAiOauth = oauth;
      fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 4));
    } catch { /* non-fatal */ }
  }

  // ── HTTP helper (Node.js https, not Electron fetch) ─

  _postForm(url, params, _depth = 0) {
    if (_depth > 5) return Promise.reject(new Error('Too many redirects'));
    const formBody = new URLSearchParams(params).toString();
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
      const req = mod.request({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(formBody),
          'User-Agent': 'claude-code/2.1',
        },
      }, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          this._postForm(next, params, _depth + 1).then(resolve, reject);
          return;
        }
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode >= 400) {
              const msg = json.error_description || json.error || JSON.stringify(json);
              const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
              err.status = res.statusCode;
              reject(err);
            } else {
              resolve(json);
            }
          } catch {
            reject(new Error(`Invalid JSON (${res.statusCode}): ${data.slice(0, 200)}`));
          }
        });
      });
      req.on('error', reject);
      req.write(formBody);
      req.end();
    });
  }

  // ── PKCE helpers ────────────────────────────────────

  _generateCodeVerifier() { return crypto.randomBytes(32).toString('base64url'); }
  _generateCodeChallenge(v) { return crypto.createHash('sha256').update(v).digest('base64url'); }

  // ── OAuth flow (fallback if no Claude Code creds) ───

  async startOAuth() {
    // First try: read existing Claude Code credentials
    const existing = this._readClaudeCredentials();
    if (existing?.refreshToken) {
      try {
        const result = await this.refreshTokens(existing.refreshToken);
        return { authenticated: true, account: result.account || null };
      } catch {
        // Refresh failed, fall through to full OAuth
      }
    }

    // Full OAuth PKCE flow
    const codeVerifier = this._generateCodeVerifier();
    const codeChallenge = this._generateCodeChallenge(codeVerifier);
    const state = crypto.randomBytes(16).toString('hex');

    return new Promise((resolve, reject) => {
      let settled = false;

      const server = http.createServer(async (req, res) => {
        if (settled) { res.writeHead(200); res.end('Already processed'); return; }
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname !== '/callback') { res.writeHead(404); res.end('Not found'); return; }

        const returnedState = url.searchParams.get('state');
        if (returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(this._callbackHTML(false, 'Invalid state parameter'));
          return;
        }

        const error = url.searchParams.get('error');
        if (error) {
          settled = true;
          const desc = url.searchParams.get('error_description') || error;
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(this._callbackHTML(false, desc));
          server.close();
          reject(new Error(desc));
          return;
        }

        const code = url.searchParams.get('code');
        if (!code) { res.writeHead(400); res.end('Missing code'); return; }

        try {
          const tokens = await this._postForm(TOKEN_URL, {
            grant_type: 'authorization_code',
            code,
            client_id: CLIENT_ID,
            code_verifier: codeVerifier,
            redirect_uri: `http://localhost:${server.address().port}/callback`,
          });

          this._saveTokens(tokens);
          settled = true;
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(this._callbackHTML(true));
          server.close();
          resolve({ authenticated: true, account: tokens.account || null });
        } catch (err) {
          const errMsg = (err && typeof err.message === 'string') ? err.message : JSON.stringify(err);
          settled = true;
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(this._callbackHTML(false, errMsg));
          server.close();
          reject(err);
        }
      });

      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        const params = new URLSearchParams({
          client_id: CLIENT_ID,
          response_type: 'code',
          redirect_uri: `http://localhost:${port}/callback`,
          scope: 'user:inference user:profile',
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          state,
        });
        const fullUrl = `${AUTH_URL}?${params.toString()}`;

        if (process.env.NODE_ENV === 'test') {
          try { fs.writeFileSync('/tmp/claude-dash-oauth-url.txt', fullUrl); } catch {}
        } else {
          shell.openExternal(fullUrl);
        }
      });

      setTimeout(() => {
        if (!settled) { settled = true; server.close(); reject(new Error('Authentication timed out')); }
      }, 5 * 60 * 1000);
    });
  }

  // ── Token management ────────────────────────────────

  _saveTokens(tokens) {
    const oauth = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(Date.now() + (tokens.expires_in || 28800) * 1000).toISOString(),
      scopes: tokens.scope ? tokens.scope.split(' ') : ['user:inference', 'user:profile'],
    };
    // Save to our store
    this.store.setSecure('tokens', JSON.stringify({ ...tokens, _obtained_at: Date.now() }));
    // Also update Claude Code's credentials file so both apps share tokens
    this._writeClaudeCredentials(oauth);
    this._scheduleRefresh(tokens.expires_in || 28800);
  }

  async refreshTokens(refreshToken) {
    const rt = refreshToken || this._getRefreshToken();
    if (!rt) throw new Error('No refresh token');

    const tokens = await this._postForm(TOKEN_URL, {
      grant_type: 'refresh_token',
      refresh_token: rt,
      client_id: CLIENT_ID,
    });

    this._saveTokens(tokens);
    return tokens;
  }

  _getRefreshToken() {
    // Try our store first, then Claude Code credentials
    const stored = this.getTokens();
    if (stored?.refresh_token) return stored.refresh_token;
    const cc = this._readClaudeCredentials();
    return cc?.refreshToken || null;
  }

  _scheduleRefresh(expiresInSec) {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const ms = Math.max((expiresInSec - 300) * 1000, 60_000);
    this.refreshTimer = setTimeout(async () => {
      try { await this.refreshTokens(); } catch {}
    }, ms);
  }

  // ── Token access ────────────────────────────────────

  getTokens() {
    try {
      const raw = this.store.getSecure('tokens');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  getAccessToken() {
    const tokens = this.getTokens();
    if (tokens?.access_token) return tokens.access_token;
    // Fallback: read from Claude Code credentials
    const cc = this._readClaudeCredentials();
    return cc?.accessToken || null;
  }

  getAccount() {
    const tokens = this.getTokens();
    return tokens?.account || null;
  }

  isAuthenticated() {
    return !!this.getAccessToken();
  }

  isTokenExpired() {
    // Check our store
    const tokens = this.getTokens();
    if (tokens?._obtained_at && tokens?.expires_in) {
      return Date.now() > tokens._obtained_at + tokens.expires_in * 1000;
    }
    // Check Claude Code credentials
    const cc = this._readClaudeCredentials();
    if (cc?.expiresAt) {
      return Date.now() > new Date(cc.expiresAt).getTime();
    }
    return true;
  }

  clearTokens() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.store.deleteSecure('tokens');
  }

  // ── Startup: silent refresh if needed ───────────────

  async ensureValidToken() {
    if (!this.isAuthenticated()) return false;
    if (this.isTokenExpired()) {
      try {
        await this.refreshTokens();
        return true;
      } catch {
        return false;
      }
    }
    // Schedule refresh for remaining lifetime
    const tokens = this.getTokens();
    if (tokens?._obtained_at && tokens?.expires_in) {
      const remaining = tokens.expires_in - (Date.now() - tokens._obtained_at) / 1000;
      if (remaining > 0) this._scheduleRefresh(remaining);
    }
    return true;
  }

  // ── Callback HTML ───────────────────────────────────

  _callbackHTML(success, errorMsg) {
    const bg = success ? '#22C55E' : '#EF4444';
    const title = success ? 'Connected to Claude!' : 'Authentication Failed';
    const sub = success
      ? 'You can close this tab and return to Claude Dash.'
      : `Error: ${errorMsg || 'Unknown error'}. Please try again.`;
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Claude Dash</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0F0A1E;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:center}
.card{padding:48px;border-radius:20px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);max-width:400px}
.dot{width:48px;height:48px;border-radius:50%;background:${bg};margin:0 auto 24px;display:flex;align-items:center;justify-content:center;font-size:24px}
h1{margin:0 0 8px;font-size:20px}p{margin:0;color:rgba(255,255,255,.5);font-size:14px;max-width:300px}</style>
</head><body><div class="card"><div class="dot">${success ? '\u2713' : '\u2717'}</div><h1>${title}</h1><p>${sub}</p></div></body></html>`;
  }
}

module.exports = { AuthManager };
