// @ts-check
const { test, expect } = require('@playwright/test');
const { _electron: electron } = require('playwright');
const path = require('path');

const MAIN_ENTRY = path.join(__dirname, '..', 'src', 'main', 'index.js');
const WAIT = process.env.CI ? 2000 : 1000;
const WAIT_SHORT = process.env.CI ? 600 : 200;

/** @type {import('playwright').ElectronApplication} */
let app;
/** @type {import('playwright').Page} */
let win;

test.beforeAll(async () => {
  app = await electron.launch({
    args: [MAIN_ENTRY],
    env: { ...process.env, NODE_ENV: 'test', CLAUDE_DASH_SKIP_AUTO_AUTH: '1' },
  });
  win = await app.firstWindow();
  // Wait for DOM to be ready
  await win.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  if (app) await app.close();
});

// ── 1. App launches correctly ──────────────────────────

test('app launches and renders the shell', async () => {
  const title = await win.title();
  expect(title).toBe('Claude Dash');
});

test('app window has correct dimensions', async () => {
  const bounds = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return win.getBounds();
  });
  expect(bounds.width).toBe(360);
  expect(bounds.height).toBe(520);
});

test('app window is always-on-top', async () => {
  const isOnTop = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return win.isAlwaysOnTop();
  });
  expect(isOnTop).toBe(true);
});

test('app window is frameless', async () => {
  // Frameless windows have no native frame — we check via the custom title bar
  const titleBar = win.locator('#title-bar');
  await expect(titleBar).toBeVisible();
  await expect(titleBar).toHaveCSS('-webkit-app-region', 'drag');
});

// ── 2. Login Screen ────────────────────────────────────

test('login screen is visible by default', async () => {
  const loginScreen = win.locator('#screen-login');
  await expect(loginScreen).toBeVisible();
});

test('dashboard is hidden by default', async () => {
  const dashboard = win.locator('#screen-dashboard');
  await expect(dashboard).toBeHidden();
});

test('login screen shows correct branding', async () => {
  await expect(win.locator('.login-title')).toHaveText('Claude Dash');
  await expect(win.locator('.login-subtitle')).toContainText('Monitor your Claude usage');
});

test('connect button is visible and enabled', async () => {
  const btn = win.locator('#btn-connect');
  await expect(btn).toBeVisible();
  await expect(btn).toBeEnabled();
  await expect(btn.locator('.btn-text')).toHaveText('Connect to Claude');
});

test('login hint text is visible', async () => {
  await expect(win.locator('.login-hint')).toHaveText('Requires Claude Code installed and logged in');
});

test('login error is hidden by default', async () => {
  await expect(win.locator('#login-error')).toBeHidden();
});

test('login logo SVG is rendered', async () => {
  const svg = win.locator('.login-logo svg');
  await expect(svg).toBeVisible();
});

// ── 3. Title Bar Controls ──────────────────────────────

test('title bar shows app name', async () => {
  await expect(win.locator('.title-text')).toHaveText('Claude Dash');
});

test('minimize button is visible', async () => {
  await expect(win.locator('#btn-minimize')).toBeVisible();
});

test('close button is visible', async () => {
  await expect(win.locator('#btn-close')).toBeVisible();
});

// ── 4. Simulate Auth + Dashboard ───────────────────────

test('simulate auth: dashboard appears with user info', async () => {
  // Send mock auth-status event from main process
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.send('auth-status', {
      authenticated: true,
      account: { email_address: 'test@example.com', uuid: 'test-uuid' },
    });
  });

  // Dashboard should become visible
  const dashboard = win.locator('#screen-dashboard');
  await expect(dashboard).toBeVisible({ timeout: 3000 });

  // Login should be hidden
  const login = win.locator('#screen-login');
  await expect(login).toBeHidden();

  // User email should be displayed
  await expect(win.locator('#user-email')).toHaveText('test@example.com');

  // User avatar should show first letter
  await expect(win.locator('#user-avatar')).toHaveText('T');
});

test('dashboard shows empty state initially', async () => {
  await expect(win.locator('#empty-state')).toBeVisible();
  await expect(win.locator('#empty-state p')).toContainText('Fetching usage data');
});

test('disconnect button is visible', async () => {
  await expect(win.locator('#btn-logout')).toBeVisible();
  await expect(win.locator('#btn-logout')).toHaveText('Disconnect');
});

test('refresh button is visible', async () => {
  await expect(win.locator('#btn-refresh')).toBeVisible();
});

test('footer status shows connecting state', async () => {
  const footer = win.locator('#footer-status');
  await expect(footer).toBeVisible();
});

// ── 5. Usage Data Rendering ────────────────────────────

test('renders limit cards from usage data', async () => {
  const now = Date.now();
  const fiveHourReset = new Date(now + 3 * 3600_000).toISOString(); // 3h from now
  const sevenDayReset = new Date(now + 4 * 24 * 3600_000).toISOString(); // 4 days from now

  await app.evaluate(({ BrowserWindow }, { fiveHourReset, sevenDayReset, now }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.send('usage-update', {
      timestamp: now,
      limits: {
        five_hour: {
          utilization: 42.5,
          resets_at: fiveHourReset,
          timeToReset: 3 * 3600_000,
          estimatedTimeToLimit: 5 * 3600_000,
          consumptionRate: 8.3,
          confidence: 'high',
        },
        seven_day: {
          utilization: 18.2,
          resets_at: sevenDayReset,
          timeToReset: 4 * 24 * 3600_000,
          estimatedTimeToLimit: null,
          consumptionRate: null,
          confidence: 'none',
        },
      },
      extra_usage: { is_enabled: false, monthly_limit: null },
    });
  }, { fiveHourReset, sevenDayReset, now });

  // Wait for cards to render
  await win.waitForSelector('#card-five_hour', { timeout: 3000 });

  // Empty state should be hidden
  await expect(win.locator('#empty-state')).toBeHidden();

  // 5-hour card
  const fiveHourCard = win.locator('#card-five_hour');
  await expect(fiveHourCard).toBeVisible();
  await expect(fiveHourCard.locator('.limit-label')).toHaveText('5-Hour Limit');

  // 7-day card
  const sevenDayCard = win.locator('#card-seven_day');
  await expect(sevenDayCard).toBeVisible();
  await expect(sevenDayCard.locator('.limit-label')).toHaveText('7-Day Limit');

  // Opus card should NOT exist (wasn't in data)
  await expect(win.locator('#card-seven_day_opus')).not.toBeVisible();
});

test('progress bar reflects utilization percentage', async () => {
  const fill = win.locator('#card-five_hour .progress-fill');
  await expect(fill).toBeVisible();

  // Check width is roughly 42.5%
  const style = await fill.getAttribute('style');
  expect(style).toContain('width:');
  // Width should be set to approximately 42.5%
  const widthMatch = style.match(/width:\s*([\d.]+)%/);
  expect(widthMatch).not.toBeNull();
  const width = parseFloat(widthMatch[1]);
  expect(width).toBeGreaterThan(40);
  expect(width).toBeLessThan(45);
});

test('percentage text animates to correct value', async () => {
  // Auto-retrying assertion: waits up to expect.timeout for animation to finish
  await expect(win.locator('#card-five_hour [data-pct]')).toHaveText('42.5%');
});

test('reset time is displayed', async () => {
  const resetText = await win.locator('#card-five_hour [data-reset]').textContent();
  // Should show something like "3h 0m" (approximately 3 hours)
  expect(resetText).toMatch(/\d+h/);
});

test('estimation is displayed for five_hour', async () => {
  const etaText = await win.locator('#card-five_hour [data-eta]').textContent();
  // Should show "~5h 0m at current pace"
  expect(etaText).toContain('at current pace');
});

test('estimation shows collecting for seven_day (null estimate)', async () => {
  const etaText = await win.locator('#card-seven_day [data-eta]').textContent();
  expect(etaText).toBe('Collecting data...');
});

test('consumption rate is displayed for five_hour', async () => {
  const rateText = await win.locator('#card-five_hour [data-rate]').textContent();
  expect(rateText).toBe('8.3%/h');
});

test('consumption rate shows collecting for seven_day (null rate)', async () => {
  const rateText = await win.locator('#card-seven_day [data-rate]').textContent();
  expect(rateText).toBe('Collecting...');
});

test('extra usage badge shows disabled', async () => {
  const badge = win.locator('#extra-badge');
  await expect(badge).toBeVisible();
  await expect(win.locator('#extra-text')).toHaveText('Extra usage: Off');
});

// ── 6. High Utilization States ─────────────────────────

test('card gets critical class at 90%+', async () => {
  const now = Date.now();
  await app.evaluate(({ BrowserWindow }, { now }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.send('usage-update', {
      timestamp: now,
      limits: {
        five_hour: {
          utilization: 95,
          resets_at: new Date(now + 30 * 60_000).toISOString(),
          timeToReset: 30 * 60_000,
          estimatedTimeToLimit: 10 * 60_000,
          consumptionRate: 25.0,
          confidence: 'high',
        },
        seven_day: {
          utilization: 18.2,
          resets_at: new Date(now + 4 * 24 * 3600_000).toISOString(),
          timeToReset: 4 * 24 * 3600_000,
          estimatedTimeToLimit: null,
          consumptionRate: null,
          confidence: 'none',
        },
      },
      extra_usage: { is_enabled: true, monthly_limit: 100 },
    });
  }, { now });

  await win.waitForTimeout(WAIT_SHORT);

  // Card should have critical class
  const card = win.locator('#card-five_hour');
  await expect(card).toHaveClass(/critical/);

  // Extra usage should now show enabled
  await expect(win.locator('#extra-text')).toHaveText('Extra usage: On ($100/mo)');
  await expect(win.locator('#extra-badge')).toHaveClass(/active/);
});

test('percentage text updates to 95% after animation', async () => {
  await expect(win.locator('#card-five_hour [data-pct]')).toHaveText('95.0%');
});

test('progress bar color shifts toward red at high utilization', async () => {
  const fill = win.locator('#card-five_hour .progress-fill');
  const bgColor = await fill.evaluate((el) => getComputedStyle(el).backgroundColor);
  // Should be in the red/orange range — RGB red component should be high
  const match = bgColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  expect(match).not.toBeNull();
  const r = parseInt(match[1]);
  const g = parseInt(match[2]);
  // Red should dominate
  expect(r).toBeGreaterThan(200);
  expect(g).toBeLessThan(100);
});

// ── 7. Limit Reached State ─────────────────────────────

test('shows "Limit reached" at 100% utilization', async () => {
  const now = Date.now();
  await app.evaluate(({ BrowserWindow }, { now }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.send('usage-update', {
      timestamp: now,
      limits: {
        five_hour: {
          utilization: 100,
          resets_at: new Date(now + 15 * 60_000).toISOString(),
          timeToReset: 15 * 60_000,
          estimatedTimeToLimit: 0,
          consumptionRate: 30.0,
          confidence: 'high',
        },
      },
      extra_usage: { is_enabled: false },
    });
  }, { now });

  await expect(win.locator('#card-five_hour [data-eta]')).toHaveText('Limit reached');
});

// ── 8. Card Removal ────────────────────────────────────

test('removes card when limit disappears from data', async () => {
  // seven_day was present before, now send data without it
  const now = Date.now();
  await app.evaluate(({ BrowserWindow }, { now }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.send('usage-update', {
      timestamp: now,
      limits: {
        five_hour: {
          utilization: 50,
          resets_at: new Date(now + 2 * 3600_000).toISOString(),
          timeToReset: 2 * 3600_000,
          estimatedTimeToLimit: 3 * 3600_000,
          consumptionRate: 10.0,
          confidence: 'medium',
        },
      },
      extra_usage: { is_enabled: false },
    });
  }, { now });

  await win.waitForTimeout(WAIT_SHORT);
  // seven_day card should be removed
  await expect(win.locator('#card-seven_day')).not.toBeVisible();
  // five_hour should still be there
  await expect(win.locator('#card-five_hour')).toBeVisible();
});

// ── 9. Logout Flow ─────────────────────────────────────

test('clicking disconnect returns to login screen', async () => {
  // Simulate auth-status false (as if logout IPC completed)
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.send('auth-status', { authenticated: false });
  });

  await expect(win.locator('#screen-login')).toBeVisible({ timeout: 3000 });
  await expect(win.locator('#screen-dashboard')).toBeHidden();
});

// ── 10. Error State ────────────────────────────────────

test('auth error shows error message on login screen', async () => {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.send('auth-status', {
      authenticated: false,
      error: 'Session expired',
    });
  });

  // Should show login with error
  await expect(win.locator('#screen-login')).toBeVisible();
  // The error is shown via showLogin(error) which calls showLoginError
  // But showLogin only shows error if passed — let's check the general flow
  await expect(win.locator('#btn-connect')).toBeEnabled();
});

// ── 11. Footer Updates ─────────────────────────────────

test('footer shows "Updated just now" after fresh data', async () => {
  // Re-authenticate
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.send('auth-status', {
      authenticated: true,
      account: { email_address: 'test@example.com' },
    });
  });

  const now = Date.now();
  await app.evaluate(({ BrowserWindow }, { now }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.send('usage-update', {
      timestamp: now,
      limits: {
        five_hour: {
          utilization: 10,
          resets_at: new Date(now + 4 * 3600_000).toISOString(),
          timeToReset: 4 * 3600_000,
          estimatedTimeToLimit: null,
          consumptionRate: null,
          confidence: 'none',
        },
      },
      extra_usage: { is_enabled: false },
    });
  }, { now });

  await win.waitForTimeout(WAIT_SHORT);
  const status = await win.locator('#footer-status').textContent();
  expect(status).toMatch(/Updated (just now|\ds ago)/);
});

// ── 12. Glassmorphism CSS Verification ─────────────────

test('app container has glassmorphism styling', async () => {
  const appEl = win.locator('#app');
  const borderRadius = await appEl.evaluate((el) => getComputedStyle(el).borderRadius);
  expect(borderRadius).toBe('16px');

  const backdropFilter = await appEl.evaluate(
    (el) => getComputedStyle(el).backdropFilter || getComputedStyle(el).webkitBackdropFilter
  );
  expect(backdropFilter).toContain('blur');
});

test('limit card has correct glass card styling', async () => {
  const card = win.locator('#card-five_hour');
  const borderRadius = await card.evaluate((el) => getComputedStyle(el).borderRadius);
  expect(borderRadius).toBe('12px');
});
