const https = require('https');
const { Notification } = require('electron');

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const POLL_INTERVAL = 30_000;       // 30s normal
const MAX_BACKOFF   = 5 * 60_000;  // 5min max on errors

const LIMIT_LABELS = {
  five_hour: '5-Hour',
  seven_day: '7-Day',
  seven_day_opus: 'Opus 7-Day',
};

class UsageTracker {
  constructor(store, authManager) {
    this.store = store;
    this.auth = authManager;
    this.pollTimer = null;
    this.currentInterval = POLL_INTERVAL;
    this.history = this.store.get('usageHistory') || [];
    this.notified = {};   // tracks fired threshold alerts per reset window
    this.onUpdate = null;
  }

  // --- Lifecycle ---

  start(onUpdate) {
    this.onUpdate = onUpdate;
    this._poll();
    this.pollTimer = setInterval(() => this._poll(), this.currentInterval);
  }

  stop() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  async manualRefresh() {
    await this._poll();
  }

  // --- Polling ---

  async _poll() {
    try {
      const token = this.auth.getAccessToken();
      if (!token) return;

      const raw = await this._fetchUsage(token);
      const enriched = this._enrich(raw);
      this._recordHistory(enriched);
      this._checkNotifications(enriched);
      this._resetBackoff();

      if (this.onUpdate) this.onUpdate(enriched);
    } catch (err) {
      if (err.status === 401) {
        try {
          await this.auth.refreshTokens();
          return this._poll(); // retry once
        } catch {
          if (this.onUpdate) this.onUpdate({ error: 'auth_expired' });
          this.stop();
          return;
        }
      }
      this._increaseBackoff();
      if (this.onUpdate) this.onUpdate({ error: err.message });
    }
  }

  // --- HTTP ---

  _fetchUsage(accessToken) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(USAGE_URL);
      const req = https.request(
        {
          hostname: parsed.hostname,
          path: parsed.pathname,
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'anthropic-beta': 'oauth-2025-04-20',
          },
        },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            if (res.statusCode >= 400) {
              const err = new Error(`Usage API ${res.statusCode}`);
              err.status = res.statusCode;
              reject(err);
            } else {
              try { resolve(JSON.parse(body)); }
              catch (e) { reject(e); }
            }
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  // --- Enrichment ---

  _enrich(raw) {
    const now = Date.now();
    const result = { timestamp: now, limits: {}, extra_usage: raw.extra_usage };

    for (const key of ['five_hour', 'seven_day', 'seven_day_opus']) {
      const limit = raw[key];
      if (!limit) continue;

      const resetsAt = new Date(limit.resets_at).getTime();
      const timeToReset = Math.max(0, resetsAt - now);

      result.limits[key] = {
        utilization: limit.utilization,
        resets_at: limit.resets_at,
        timeToReset,
        estimatedTimeToLimit: this._estimateTimeToLimit(key, limit.utilization),
        consumptionRate: this._getRate(key),
      };
    }

    return result;
  }

  // --- Prediction ---

  _estimateTimeToLimit(key, currentUtil) {
    if (currentUtil >= 100) return 0;
    if (currentUtil === 0) return null;

    const twoHoursAgo = Date.now() - 2 * 3600_000;
    let window = this.history.filter((h) => h.limits?.[key]?.utilization != null && h.timestamp > twoHoursAgo);
    if (window.length < 2) {
      window = this.history.filter((h) => h.limits?.[key]?.utilization != null);
    }
    if (window.length < 2) return null;

    // Find the longest monotonically-increasing run ending at the newest point.
    // If utilization drops (window reset), only use data after the drop.
    let startIdx = 0;
    for (let i = window.length - 1; i > 0; i--) {
      if (window[i].limits[key].utilization < window[i - 1].limits[key].utilization) {
        startIdx = i;
        break;
      }
    }
    const segment = window.slice(startIdx);
    if (segment.length < 2) return null;

    const oldest = segment[0];
    const newest = segment[segment.length - 1];
    const dt = newest.timestamp - oldest.timestamp;
    const du = newest.limits[key].utilization - oldest.limits[key].utilization;

    if (du <= 0 || dt < 30_000) return null;

    const ratePerMs = du / dt;
    return (100 - currentUtil) / ratePerMs;
  }

  _getRate(key) {
    const oneHourAgo = Date.now() - 3600_000;
    const recent = this.history.filter((h) => h.limits?.[key]?.utilization != null && h.timestamp > oneHourAgo);
    if (recent.length < 2) return null;

    const oldest = recent[0];
    const newest = recent[recent.length - 1];
    const dt = newest.timestamp - oldest.timestamp;
    const du = newest.limits[key].utilization - oldest.limits[key].utilization;
    if (dt < 30_000) return null;

    return (du / dt) * 3600_000; // %/hour
  }

  // --- History ---

  _recordHistory(data) {
    this.history.push({ timestamp: data.timestamp, limits: data.limits });
    // Prune to 24h
    const cutoff = Date.now() - 24 * 3600_000;
    this.history = this.history.filter((h) => h.timestamp > cutoff);
    this.store.set('usageHistory', this.history);
  }

  // --- Notifications ---

  _checkNotifications(data) {
    for (const [key, limit] of Object.entries(data.limits)) {
      if (!limit) continue;
      const windowKey = `${key}_${limit.resets_at}`;

      if (limit.utilization >= 95 && !this.notified[`${windowKey}_95`]) {
        this._notify(
          `${LIMIT_LABELS[key]} at ${limit.utilization.toFixed(0)}%`,
          `Critically high! Resets ${this._fmtDuration(limit.timeToReset)}`,
        );
        this.notified[`${windowKey}_95`] = true;
      } else if (limit.utilization >= 80 && !this.notified[`${windowKey}_80`]) {
        this._notify(
          `${LIMIT_LABELS[key]} at ${limit.utilization.toFixed(0)}%`,
          `Approaching limit. Resets ${this._fmtDuration(limit.timeToReset)}`,
        );
        this.notified[`${windowKey}_80`] = true;
      }
    }
  }

  _notify(title, body) {
    if (!Notification.isSupported()) return;
    new Notification({ title: `Claude Dash \u2014 ${title}`, body }).show();
  }

  _fmtDuration(ms) {
    if (ms <= 0) return 'now';
    const h = Math.floor(ms / 3600_000);
    const m = Math.floor((ms % 3600_000) / 60_000);
    if (h >= 24) return `in ${Math.floor(h / 24)}d ${h % 24}h`;
    if (h > 0) return `in ${h}h ${m}m`;
    return `in ${m}m`;
  }

  // --- Backoff ---

  _resetBackoff() {
    if (this.currentInterval !== POLL_INTERVAL) {
      this.currentInterval = POLL_INTERVAL;
      if (this.pollTimer) clearInterval(this.pollTimer);
      this.pollTimer = setInterval(() => this._poll(), this.currentInterval);
    }
  }

  _increaseBackoff() {
    this.currentInterval = Math.min(this.currentInterval * 2, MAX_BACKOFF);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this._poll(), this.currentInterval);
  }
}

module.exports = { UsageTracker };
