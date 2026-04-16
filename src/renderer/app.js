// ── Claude Dash – Renderer ──────────────────────────────

const $ = (sel) => document.querySelector(sel);
const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');

// ── Elements ────────────────────────────────────────────

const screenLogin = $('#screen-login');
const screenDash = $('#screen-dashboard');
const btnConnect = $('#btn-connect');
const btnLoader = $('#btn-loader');
const btnText = btnConnect.querySelector('.btn-text');
const loginError = $('#login-error');
const userEmail = $('#user-email');
const userAvatar = $('#user-avatar');
const limitsContainer = $('#limits-container');
const emptyState = $('#empty-state');
const extraBadge = $('#extra-badge');
const extraText = $('#extra-text');
const footerStatus = $('#footer-status');
const btnRefresh = $('#btn-refresh');
const errorOverlay = $('#error-overlay');
const errorMessage = $('#error-message');
const screenMini = $('#screen-mini');
const miniGauges = $('#mini-gauges');
const btnToggleView = $('#btn-toggle-view');
const appEl = $('#app');

// ── State ───────────────────────────────────────────────

let currentLimits = {};
let isMiniView = false;
let lastUsageData = null;

const FULL_WIDTH = 360;
const FULL_HEIGHT = 520;
const MINI_WIDTH = 300;
const MINI_HEIGHT = 130;
let animatedValues = {};

// ── Init ────────────────────────────────────────────────

async function init() {
  setupControls();
  setupEvents();

  const status = await window.claudeDash.getAuthStatus();
  if (status.authenticated) {
    showDashboard(status.account);
  } else {
    showLogin();
  }
}

// ── Controls ────────────────────────────────────────────

function setupControls() {
  $('#btn-close').addEventListener('click', () => window.claudeDash.closeApp());
  $('#btn-minimize').addEventListener('click', () => window.claudeDash.minimizeApp());

  btnConnect.addEventListener('click', handleConnect);
  $('#btn-logout').addEventListener('click', handleLogout);
  $('#btn-retry').addEventListener('click', handleRetry);

  btnToggleView.addEventListener('click', toggleMiniView);

  btnRefresh.addEventListener('click', () => {
    btnRefresh.classList.add('spinning');
    window.claudeDash.refreshUsage();
    setTimeout(() => btnRefresh.classList.remove('spinning'), 600);
  });
}

function setupEvents() {
  window.claudeDash.onAuthStatus((data) => {
    if (data.authenticated) {
      showDashboard(data.account);
    } else {
      showLogin(data.error);
    }
  });

  window.claudeDash.onUsageUpdate((data) => {
    if (data.error) {
      if (data.error === 'auth_expired') {
        showLogin('Session expired. Please reconnect.');
      } else {
        footerStatus.textContent = `Error: ${data.error}`;
      }
      return;
    }
    renderUsage(data);
  });
}

// ── Auth handlers ───────────────────────────────────────

async function handleConnect() {
  btnConnect.disabled = true;
  hide(loginError);
  btnText.textContent = 'Connecting...';
  show(btnLoader);

  try {
    const result = await window.claudeDash.startAuth();
    if (!result.authenticated) {
      showLoginError(result.error || 'Connection failed');
    }
  } catch (err) {
    showLoginError(err.message || 'Connection failed');
  } finally {
    resetLoginButton();
  }
}

function handleLogout() {
  window.claudeDash.logout();
  currentLimits = {};
  animatedValues = {};
  showLogin();
}

function handleRetry() {
  hide(errorOverlay);
  window.claudeDash.refreshUsage();
}

// ── Screen transitions ──────────────────────────────────

function showLogin(error) {
  hide(screenDash);
  hide(errorOverlay);
  show(screenLogin);
  resetLoginButton();
  if (error) showLoginError(error);
}

function showDashboard(account) {
  hide(screenLogin);
  hide(errorOverlay);
  show(screenDash);

  if (account?.email_address) {
    userEmail.textContent = account.email_address;
    userAvatar.textContent = account.email_address[0].toUpperCase();
  }
}

function showLoginError(msg) {
  loginError.textContent = msg;
  show(loginError);
  resetLoginButton();
}

function resetLoginButton() {
  btnConnect.disabled = false;
  btnText.textContent = 'Connect to Claude';
  hide(btnLoader);
}

// ── Usage rendering ─────────────────────────────────────

function renderUsage(data) {
  lastUsageData = data;
  const { limits, extra_usage, timestamp } = data;

  // Update mini view if active
  if (isMiniView) {
    renderMiniGauges(limits);
    return;
  }

  // Update footer
  footerStatus.textContent = `Updated ${formatAgo(timestamp)}`;

  // Clear empty state
  if (Object.keys(limits).length > 0) {
    hide(emptyState);
  }

  // Render / update each limit card
  const order = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'seven_day_cowork'];
  for (const key of order) {
    const limit = limits[key];
    if (!limit) {
      removeCard(key);
      continue;
    }
    upsertCard(key, limit);
  }

  // Extra usage badge
  if (extra_usage) {
    show(extraBadge);
    if (extra_usage.is_enabled) {
      extraBadge.classList.add('active');
      extraText.textContent = extra_usage.monthly_limit
        ? `Extra usage: On ($${extra_usage.monthly_limit}/mo)`
        : 'Extra usage: On';
    } else {
      extraBadge.classList.remove('active');
      extraText.textContent = 'Extra usage: Off';
    }
  }

  // Refresh footer periodically
  startFooterTimer(timestamp);
}

// ── Card CRUD ───────────────────────────────────────────

const LABELS = {
  five_hour: '5-Hour Limit',
  seven_day: '7-Day Limit',
  seven_day_opus: 'Opus 7-Day Limit',
  seven_day_sonnet: 'Sonnet 7-Day Limit',
  seven_day_cowork: 'Cowork 7-Day Limit',
};

const ICONS = {
  reset: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M12 7a5 5 0 1 1-1.5-3.5M12 2v3.5H8.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  clock: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.2"/><path d="M7 4.5V7l2 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  rate: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 10l3-3 2.5 2L12 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 4h3v3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function upsertCard(key, limit) {
  let card = $(`#card-${key}`);

  if (!card) {
    card = document.createElement('div');
    card.className = 'limit-card';
    card.id = `card-${key}`;
    card.innerHTML = `
      <div class="limit-header">
        <span class="limit-label">${LABELS[key]}</span>
        <span class="limit-pct" data-pct>0%</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" data-fill></div>
      </div>
      <div class="limit-details">
        <div class="detail-row">
          <span class="detail-icon">${ICONS.reset}</span>
          <span class="detail-label">Reset</span>
          <span class="detail-value" data-reset>--</span>
        </div>
        <div class="detail-row">
          <span class="detail-icon">${ICONS.clock}</span>
          <span class="detail-label">ETA</span>
          <span class="detail-value estimation" data-eta>--</span>
        </div>
        <div class="detail-row">
          <span class="detail-icon">${ICONS.rate}</span>
          <span class="detail-label">Rate</span>
          <span class="detail-value rate" data-rate>--</span>
        </div>
      </div>`;
    limitsContainer.appendChild(card);
    animatedValues[key] = 0;
  }

  // Animate percentage
  const pctEl = card.querySelector('[data-pct]');
  const from = animatedValues[key] || 0;
  const to = limit.utilization;
  animateNumber(pctEl, from, to, 800);
  animatedValues[key] = to;

  // Progress bar
  const fill = card.querySelector('[data-fill]');
  const color = getProgressColor(to);
  fill.style.width = `${Math.min(to, 100)}%`;
  fill.style.backgroundColor = color;
  fill.style.color = color; // for box-shadow via currentColor

  // Critical state
  card.classList.toggle('critical', to >= 90);

  // Reset time
  card.querySelector('[data-reset]').textContent = formatDuration(limit.timeToReset);

  // Estimation with confidence indicator
  const etaEl = card.querySelector('[data-eta]');
  etaEl.textContent = formatEstimation(limit.estimatedTimeToLimit, to, limit.confidence);

  // Rate
  const rateEl = card.querySelector('[data-rate]');
  rateEl.textContent = limit.consumptionRate != null
    ? `${limit.consumptionRate.toFixed(1)}%/h`
    : 'Collecting...';

  // Color the percentage text
  pctEl.style.color = color;
}

function removeCard(key) {
  const card = $(`#card-${key}`);
  if (card) {
    card.remove();
    delete animatedValues[key];
  }
}

// ── Number animation ────────────────────────────────────

function animateNumber(el, from, to, durationMs) {
  const start = performance.now();
  const update = (now) => {
    const t = Math.min((now - start) / durationMs, 1);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
    const val = from + (to - from) * eased;
    el.textContent = `${val.toFixed(1)}%`;
    if (t < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}

// ── Color interpolation ─────────────────────────────────

function getProgressColor(pct) {
  const stops = [
    { p: 0,  c: [34, 197, 94] },   // green
    { p: 60, c: [234, 179, 8] },    // yellow
    { p: 80, c: [249, 115, 22] },   // orange
    { p: 95, c: [239, 68, 68] },    // red
  ];

  if (pct <= stops[0].p) return rgb(stops[0].c);
  if (pct >= stops[stops.length - 1].p) return rgb(stops[stops.length - 1].c);

  for (let i = 0; i < stops.length - 1; i++) {
    if (pct >= stops[i].p && pct <= stops[i + 1].p) {
      const range = stops[i + 1].p - stops[i].p || 1;
      const t = (pct - stops[i].p) / range;
      return rgb(lerp3(stops[i].c, stops[i + 1].c, t));
    }
  }
  return rgb(stops[0].c);
}

function lerp3(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function rgb(c) {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

// ── Formatting ──────────────────────────────────────────

function formatDuration(ms) {
  if (ms == null || ms <= 0) return 'Now';
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  }
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatEstimation(ms, utilization, confidence) {
  if (utilization >= 100) return 'Limit reached';
  if (ms === 0) return 'Limit reached';
  if (ms == null || confidence === 'none') return 'Collecting data...';
  if (ms > 30 * 24 * 3600_000) return 'Safe pace';

  const time = formatDuration(ms);
  if (confidence === 'high')   return `${time} at current pace`;
  if (confidence === 'medium') return `~${time} at current pace`;
  return `~${time} (estimating...)`;
}

function formatAgo(timestamp) {
  const sec = Math.floor((Date.now() - timestamp) / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  return `${Math.floor(sec / 60)}m ago`;
}

// ── Footer timer ────────────────────────────────────────

let footerInterval = null;
function startFooterTimer(timestamp) {
  if (footerInterval) clearInterval(footerInterval);
  footerInterval = setInterval(() => {
    footerStatus.textContent = `Updated ${formatAgo(timestamp)}`;
  }, 5000);
}

// ── Mini View ───────────────────────────────────────────

const MINI_LABELS = {
  five_hour: '5H',
  seven_day: '7D',
  seven_day_opus: 'OPUS',
  seven_day_sonnet: 'SNNT',
  seven_day_cowork: 'COWK',
};

function toggleMiniView() {
  isMiniView = !isMiniView;
  btnToggleView.classList.toggle('active', isMiniView);
  appEl.classList.toggle('mini', isMiniView);

  if (isMiniView) {
    hide(screenDash);
    show(screenMini);
    window.claudeDash.resizeWindow(MINI_WIDTH, MINI_HEIGHT);
    if (lastUsageData) renderMiniGauges(lastUsageData.limits);
  } else {
    hide(screenMini);
    show(screenDash);
    window.claudeDash.resizeWindow(FULL_WIDTH, FULL_HEIGHT);
    if (lastUsageData) renderUsage(lastUsageData);
  }
}

function renderMiniGauges(limits) {
  const order = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'seven_day_cowork'];
  const active = order.filter((k) => limits[k]);

  miniGauges.innerHTML = active.map((key) => {
    const l = limits[key];
    const pct = l.utilization;
    const color = getProgressColor(pct);
    const label = MINI_LABELS[key];
    const eta = formatMiniEta(l.estimatedTimeToLimit, pct);

    // SVG ring gauge: radius 30, stroke 5
    const R = 30;
    const STROKE = 5;
    const CIRC = 2 * Math.PI * R;
    const offset = CIRC * (1 - Math.min(pct, 100) / 100);

    return `<div class="mini-gauge" style="--gauge-color: ${color}40">
      <svg width="70" height="70" viewBox="0 0 70 70">
        <circle cx="35" cy="35" r="${R}" fill="none" class="mini-gauge-track" stroke-width="${STROKE}"/>
        <circle cx="35" cy="35" r="${R}" fill="none" class="mini-gauge-fill"
          stroke="${color}" stroke-width="${STROKE}"
          stroke-dasharray="${CIRC}" stroke-dashoffset="${offset}"
          transform="rotate(-90 35 35)"/>
        <text x="35" y="32" text-anchor="middle" class="mini-gauge-pct">${Math.round(pct)}%</text>
        <text x="35" y="45" text-anchor="middle" class="mini-gauge-eta">${eta}</text>
      </svg>
      <span class="mini-gauge-label">${label}</span>
    </div>`;
  }).join('');
}

function formatMiniEta(ms, utilization) {
  if (utilization >= 100) return 'FULL';
  if (ms == null || ms <= 0) return '';
  if (ms > 30 * 24 * 3600_000) return 'OK';
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  if (h >= 24) return `${Math.floor(h / 24)}d`;
  if (h > 0) return `${h}h${m > 0 ? m : ''}`;
  return `${m}m`;
}

// ── Boot ────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
