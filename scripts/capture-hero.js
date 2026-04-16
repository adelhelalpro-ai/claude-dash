/**
 * Capture hero screenshot of Claude Dash with mock data
 */
const { _electron: electron } = require('playwright');
const path = require('path');

const MAIN_ENTRY = path.join(__dirname, '..', 'src', 'main', 'index.js');

(async () => {
  const app = await electron.launch({
    args: [MAIN_ENTRY],
    env: { ...process.env, NODE_ENV: 'test', CLAUDE_DASH_SKIP_AUTO_AUTH: '1' },
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  // Switch to dashboard with mock user
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.webContents.send('auth-status', {
      authenticated: true,
      account: { email_address: 'adel@orbitalis.tech', uuid: 'mock' },
    });
  });
  await win.waitForTimeout(300);

  // Send realistic usage data
  const now = Date.now();
  await app.evaluate(({ BrowserWindow }, { now }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.webContents.send('usage-update', {
      timestamp: now,
      limits: {
        five_hour: {
          utilization: 67.3,
          resets_at: new Date(now + 2.5 * 3600_000).toISOString(),
          timeToReset: 2.5 * 3600_000,
          estimatedTimeToLimit: 1.8 * 3600_000,
          consumptionRate: 12.4,
        },
        seven_day: {
          utilization: 23.1,
          resets_at: new Date(now + 5 * 24 * 3600_000).toISOString(),
          timeToReset: 5 * 24 * 3600_000,
          estimatedTimeToLimit: 18 * 3600_000,
          consumptionRate: 3.2,
        },
        seven_day_sonnet: {
          utilization: 8.5,
          resets_at: new Date(now + 5 * 24 * 3600_000).toISOString(),
          timeToReset: 5 * 24 * 3600_000,
          estimatedTimeToLimit: null,
          consumptionRate: 1.1,
        },
      },
      extra_usage: { is_enabled: true, monthly_limit: 200 },
    });
  }, { now });

  // Wait for animations
  await win.waitForTimeout(1200);

  // Capture screenshot
  const outPath = path.join(__dirname, '..', 'assets', 'hero-screenshot.png');
  await win.screenshot({ path: outPath, type: 'png' });
  console.log(`Saved: ${outPath}`);

  await app.close();
})();
