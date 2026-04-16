const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { shell } = require('electron');

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const AUTH_URL = 'https://claude.ai/oauth/authorize';
const TOKEN_URL = 'https://console.anthropic.com/api/oauth/token';

class AuthManager {
  constructor(store) {
    this.store = store;
    this.refreshTimer = null;
  }

  // --- PKCE helpers ---

  _generateCodeVerifier() {
    return crypto.randomBytes(32).toString('base64url');
  }

  _generateCodeChallenge(verifier) {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
  }

  // --- HTTP helper ---

  _postJSON(url, body) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const payload = JSON.stringify(body);
      const req = https.request(
        {
          hostname: parsed.hostname,
          path: parsed.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (res.statusCode >= 400) {
                const err = new Error(json.error_description || json.error || 'Request failed');
                err.status = res.statusCode;
                reject(err);
              } else {
                resolve(json);
              }
            } catch (e) {
              reject(new Error(`Invalid JSON response: ${data.slice(0, 200)}`));
            }
          });
        },
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  // --- OAuth flow ---

  async startOAuth() {
    const codeVerifier = this._generateCodeVerifier();
    const codeChallenge = this._generateCodeChallenge(codeVerifier);

    return new Promise((resolve, reject) => {
      let settled = false;

      const server = http.createServer(async (req, res) => {
        if (settled) return;
        const url = new URL(req.url, `http://localhost`);
        if (url.pathname !== '/callback') {
          res.writeHead(404);
          res.end('Not found');
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
        if (!code) {
          res.writeHead(400);
          res.end('Missing code');
          return;
        }

        try {
          const tokens = await this._exchangeCode(code, codeVerifier, server.address().port);
          tokens._obtained_at = Date.now();
          this.store.setSecure('tokens', JSON.stringify(tokens));
          this._scheduleRefresh(tokens.expires_in);

          settled = true;
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(this._callbackHTML(true));
          server.close();
          resolve({
            authenticated: true,
            account: tokens.account || null,
          });
        } catch (err) {
          settled = true;
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(this._callbackHTML(false, err.message));
          server.close();
          reject(err);
        }
      });

      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        const redirectUri = `http://localhost:${port}/callback`;
        const params = new URLSearchParams({
          client_id: CLIENT_ID,
          response_type: 'code',
          redirect_uri: redirectUri,
          scope: 'user:inference user:profile',
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
        });
        shell.openExternal(`${AUTH_URL}?${params.toString()}`);
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        if (!settled) {
          settled = true;
          server.close();
          reject(new Error('Authentication timed out'));
        }
      }, 5 * 60 * 1000);
    });
  }

  async _exchangeCode(code, codeVerifier, port) {
    return this._postJSON(TOKEN_URL, {
      grant_type: 'authorization_code',
      code,
      client_id: CLIENT_ID,
      code_verifier: codeVerifier,
      redirect_uri: `http://localhost:${port}/callback`,
    });
  }

  // --- Token refresh ---

  async refreshTokens() {
    const tokens = this.getTokens();
    if (!tokens?.refresh_token) throw new Error('No refresh token');

    const newTokens = await this._postJSON(TOKEN_URL, {
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: CLIENT_ID,
    });

    newTokens._obtained_at = Date.now();
    this.store.setSecure('tokens', JSON.stringify(newTokens));
    this._scheduleRefresh(newTokens.expires_in);
    return newTokens;
  }

  _scheduleRefresh(expiresInSec) {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    // Refresh 5 minutes before expiry
    const ms = Math.max((expiresInSec - 300) * 1000, 60_000);
    this.refreshTimer = setTimeout(async () => {
      try {
        await this.refreshTokens();
      } catch {
        // Will be caught on next usage poll
      }
    }, ms);
  }

  // --- Token access ---

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
    return tokens?.access_token || null;
  }

  getAccount() {
    const tokens = this.getTokens();
    return tokens?.account || null;
  }

  isAuthenticated() {
    return !!this.getAccessToken();
  }

  isTokenExpired() {
    const tokens = this.getTokens();
    if (!tokens?._obtained_at || !tokens?.expires_in) return true;
    return Date.now() > tokens._obtained_at + tokens.expires_in * 1000;
  }

  clearTokens() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.store.deleteSecure('tokens');
  }

  // --- Startup: silent refresh if needed ---

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

    // Schedule refresh for the remaining lifetime
    const tokens = this.getTokens();
    const elapsed = (Date.now() - tokens._obtained_at) / 1000;
    const remaining = tokens.expires_in - elapsed;
    if (remaining > 0) this._scheduleRefresh(remaining);
    return true;
  }

  // --- Callback page ---

  _callbackHTML(success, errorMsg) {
    const bg = success ? '#22C55E' : '#EF4444';
    const title = success ? 'Connected to Claude!' : 'Authentication Failed';
    const sub = success
      ? 'You can close this tab and return to Claude Dash.'
      : `Error: ${errorMsg || 'Unknown error'}. Please try again.`;
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Claude Dash</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0F0A1E;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:center}
.card{padding:48px;border-radius:20px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1)}
.dot{width:48px;height:48px;border-radius:50%;background:${bg};margin:0 auto 24px;display:flex;align-items:center;justify-content:center;font-size:24px}
h1{margin:0 0 8px;font-size:20px}p{margin:0;color:rgba(255,255,255,.5);font-size:14px;max-width:300px}</style>
</head><body><div class="card"><div class="dot">${success ? '\u2713' : '\u2717'}</div><h1>${title}</h1><p>${sub}</p></div></body></html>`;
  }
}

module.exports = { AuthManager };
