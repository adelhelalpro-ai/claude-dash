const https = require('https');
const { Notification } = require('electron');

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const POLL_INTERVAL = 5 * 60_000;   // 5min — endpoint allows ~5 req/token before 429
const MAX_BACKOFF   = 15 * 60_000;  // 15min max on errors

const LIMIT_LABELS = {
  five_hour: '5-Hour',
  seven_day: '7-Day',
  seven_day_opus: 'Opus 7-Day',
  seven_day_sonnet: 'Sonnet 7-Day',
  seven_day_cowork: 'Cowork 7-Day',
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
      // 401 or 429: refresh token (429 rate limit is per-token, new token resets it)
      if (err.status === 401 || err.status === 429) {
        try {
          await this.auth.refreshTokens();
          if (err.status === 429) {
            // Don't retry immediately — wait before next poll with the fresh token
            this._increaseBackoff(60_000);
            if (this.onUpdate) this.onUpdate({ error: 'Rate limited, refreshed token. Retrying in 1m...' });
            return;
          }
          return this._poll(); // 401: retry once with new token
        } catch {
          if (this.onUpdate) this.onUpdate({ error: 'auth_expired' });
          this.stop();
          return;
        }
      }
      this._increaseBackoff(err.retryAfter);
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
            'User-Agent': 'claude-code/2.1',
          },
        },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            if (res.statusCode === 429) {
              const retryAfter = parseInt(res.headers['retry-after'] || '60', 10);
              const err = new Error(`Rate limited, retry in ${retryAfter}s`);
              err.status = 429;
              err.retryAfter = retryAfter * 1000;
              reject(err);
            } else if (res.statusCode >= 400) {
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

    for (const key of ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'seven_day_cowork']) {
      const limit = raw[key];
      if (!limit) continue;

      const resetsAt = new Date(limit.resets_at).getTime();
      const timeToReset = Math.max(0, resetsAt - now);

      const prediction = this._predict(key, limit.utilization);

      result.limits[key] = {
        utilization: limit.utilization,
        resets_at: limit.resets_at,
        timeToReset,
        estimatedTimeToLimit: prediction.eta,
        consumptionRate: prediction.rate,
        confidence: prediction.confidence,
      };
    }

    return result;
  }

  // ── Prediction Engine ─────────────────────────────────
  //
  // Instead of a naive fixed-window linear projection, we use:
  //
  // 1. Reset-aware segmentation — only use data after the last utilization
  //    drop (rolling window reset).
  //
  // 2. EWMA (Exponential Weighted Moving Average) — recent samples weigh
  //    more than old ones via an exponential decay with configurable
  //    half-life. Naturally adapts to changing consumption patterns.
  //
  // 3. Multi-horizon consensus — compute rates over 10min, 30min, 1h, and
  //    2h windows. When they agree, confidence is high. When the short
  //    window diverges from the long one, the user is accelerating or
  //    decelerating and we adapt the estimate.
  //
  // 4. Acceleration-aware blending — if the short-term rate is
  //    significantly higher than the long-term rate, the user is ramping
  //    up and we bias toward the faster rate (conservative ETA). If they
  //    are slowing down, we blend toward the slower rate.
  //
  // 5. Confidence signal — returned to the UI so it can display "~" for
  //    medium confidence or "estimating…" for low confidence.

  _predict(key, currentUtil) {
    if (currentUtil >= 100) return { eta: 0, rate: null, confidence: 'high' };

    const segment = this._getSegment(key);
    if (segment.length < 2) return { eta: null, rate: null, confidence: 'none' };

    // Compute rates at multiple horizons
    const rates = {
      short:  this._windowRate(segment, key, 10 * 60_000),   // 10 min
      medium: this._windowRate(segment, key, 30 * 60_000),   // 30 min
      long:   this._windowRate(segment, key, 60 * 60_000),   // 1 h
      full:   this._windowRate(segment, key, 2 * 3600_000),  // 2 h
      ewma:   this._ewmaRate(segment, key, 15 * 60_000),     // 15 min half-life
    };

    // Pick the best rate and assess confidence
    const { rate, confidence } = this._selectRate(rates, segment, key);

    if (rate == null || rate <= 0 || currentUtil === 0) {
      return { eta: null, rate: this._toPerHour(rate), confidence: 'none' };
    }

    const eta = (100 - currentUtil) / rate; // ms until 100%
    return { eta, rate: this._toPerHour(rate), confidence };
  }

  /** Extract the monotonically-increasing segment since the last reset. */
  _getSegment(key) {
    const all = this.history.filter((h) => h.limits?.[key]?.utilization != null);
    if (all.length < 2) return all;

    let startIdx = 0;
    for (let i = all.length - 1; i > 0; i--) {
      if (all[i].limits[key].utilization < all[i - 1].limits[key].utilization) {
        startIdx = i;
        break;
      }
    }
    return all.slice(startIdx);
  }

  /** Simple rate over the most recent `windowMs` of a segment (%/ms). */
  _windowRate(segment, key, windowMs) {
    const now = Date.now();
    const windowed = segment.filter((h) => h.timestamp > now - windowMs);
    if (windowed.length < 2) return null;

    const first = windowed[0];
    const last = windowed[windowed.length - 1];
    const dt = last.timestamp - first.timestamp;
    const du = last.limits[key].utilization - first.limits[key].utilization;
    if (dt < 30_000 || du < 0) return null;
    return du / dt;
  }

  /**
   * EWMA rate — weights each inter-sample rate by exp(-lambda * age).
   * Half-life controls how quickly old data fades.
   * Returns %/ms.
   */
  _ewmaRate(segment, key, halfLifeMs) {
    if (segment.length < 2) return null;
    const now = Date.now();
    const lambda = Math.LN2 / halfLifeMs;

    let weightedRateSum = 0;
    let totalWeight = 0;

    for (let i = 1; i < segment.length; i++) {
      const dt = segment[i].timestamp - segment[i - 1].timestamp;
      const du = segment[i].limits[key].utilization - segment[i - 1].limits[key].utilization;
      if (dt < 10_000 || du < 0) continue; // skip noise / resets

      const midAge = now - (segment[i].timestamp + segment[i - 1].timestamp) / 2;
      const weight = Math.exp(-lambda * midAge);
      weightedRateSum += (du / dt) * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? weightedRateSum / totalWeight : null;
  }

  /**
   * Select the best rate from multi-horizon candidates and compute a
   * confidence level based on how well they agree.
   */
  _selectRate(rates, segment, key) {
    const valid = Object.entries(rates)
      .filter(([, r]) => r != null && r > 0)
      .map(([name, r]) => ({ name, r }));

    if (valid.length === 0) return { rate: null, confidence: 'none' };
    if (valid.length === 1) return { rate: valid[0].r, confidence: 'low' };

    // Mean and coefficient of variation (CV) of all valid rates
    const mean = valid.reduce((s, v) => s + v.r, 0) / valid.length;
    const variance = valid.reduce((s, v) => s + (v.r - mean) ** 2, 0) / valid.length;
    const cv = Math.sqrt(variance) / (mean || 1);

    // Acceleration detection: compare short-term to long-term
    const shortRate = rates.short ?? rates.medium;
    const longRate = rates.full ?? rates.long;

    let bestRate;
    if (rates.ewma != null) {
      bestRate = rates.ewma; // EWMA as default primary
    } else {
      bestRate = mean;
    }

    // If the user is accelerating (short >> long), bias toward the faster
    // rate for a conservative (earlier) ETA.
    if (shortRate != null && longRate != null && longRate > 0) {
      const accelRatio = shortRate / longRate;
      if (accelRatio > 1.5) {
        // Accelerating: blend 70% short, 30% EWMA
        bestRate = shortRate * 0.7 + bestRate * 0.3;
      } else if (accelRatio < 0.5) {
        // Decelerating: blend 70% EWMA (already includes recent slowdown)
        bestRate = bestRate * 0.7 + longRate * 0.3;
      }
    }

    // Confidence based on:
    // - Number of data points in the segment
    // - Agreement across horizons (low CV = high agreement)
    const confidence = (valid.length >= 3 && cv < 0.3 && segment.length >= 5)  ? 'high'
                     : (valid.length >= 2 && cv < 0.6 && segment.length >= 3)  ? 'medium'
                     : 'low';

    return { rate: bestRate, confidence };
  }

  /** Convert rate from %/ms to %/hour for display. */
  _toPerHour(ratePerMs) {
    return ratePerMs != null ? ratePerMs * 3600_000 : null;
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

  _increaseBackoff(retryAfterMs) {
    this.currentInterval = retryAfterMs
      ? Math.min(retryAfterMs, MAX_BACKOFF)
      : Math.min(this.currentInterval * 2, MAX_BACKOFF);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this._poll(), this.currentInterval);
  }
}

module.exports = { UsageTracker };
