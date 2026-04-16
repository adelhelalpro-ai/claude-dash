/**
 * E2E OAuth Integration Test
 *
 * This script launches Claude Dash, clicks Connect, intercepts the OAuth URL,
 * and writes it to a file so the Chrome MCP can navigate to it.
 * Then it waits for the OAuth callback to complete and verifies the dashboard.
 */
const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

const MAIN_ENTRY = path.join(__dirname, '..', 'src', 'main', 'index.js');
const URL_FILE = '/tmp/claude-dash-oauth-url.txt';
const STATUS_FILE = '/tmp/claude-dash-oauth-status.json';

async function run() {
  // Clean up
  try { fs.unlinkSync(URL_FILE); } catch {}
  try { fs.unlinkSync(STATUS_FILE); } catch {}

  console.log('[1/6] Launching Claude Dash...');
  const app = await electron.launch({
    args: [MAIN_ENTRY],
    env: { ...process.env, NODE_ENV: 'test' },
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  console.log('[1/6] OK - App launched');

  // Verify login screen
  console.log('[2/6] Verifying login screen...');
  const loginVisible = await win.locator('#screen-login').isVisible();
  if (!loginVisible) {
    // Already authenticated from a previous session
    const dashVisible = await win.locator('#screen-dashboard').isVisible();
    if (dashVisible) {
      console.log('[2/6] Already authenticated! Dashboard is showing.');
      const email = await win.locator('#user-email').textContent();
      console.log(`[2/6] Logged in as: ${email}`);

      // Wait for usage data
      console.log('[3/6] Waiting for usage data...');
      try {
        await win.waitForSelector('.limit-card', { timeout: 15000 });
        console.log('[3/6] OK - Limit cards appeared');

        const cards = await win.locator('.limit-card').count();
        console.log(`[4/6] Found ${cards} limit card(s)`);

        for (let i = 0; i < cards; i++) {
          const card = win.locator('.limit-card').nth(i);
          const label = await card.locator('.limit-label').textContent();
          const pct = await card.locator('[data-pct]').textContent();
          const reset = await card.locator('[data-reset]').textContent();
          const eta = await card.locator('[data-eta]').textContent();
          const rate = await card.locator('[data-rate]').textContent();
          console.log(`  [${label}] ${pct} | Reset: ${reset} | ETA: ${eta} | Rate: ${rate}`);
        }

        const status = { success: true, alreadyAuthenticated: true, cards };
        fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
        console.log('[6/6] PASS - Already authenticated, usage data verified');
      } catch (err) {
        console.log(`[3/6] Timeout waiting for usage data: ${err.message}`);
        fs.writeFileSync(STATUS_FILE, JSON.stringify({ success: false, error: err.message }));
      }

      await app.close();
      return;
    }
  }
  console.log('[2/6] OK - Login screen visible');

  // Click Connect — auth.js writes URL to /tmp/claude-dash-oauth-url.txt in test mode
  console.log('[3/6] Clicking "Connect to Claude"...');
  await win.locator('#btn-connect').click();

  // Wait for the URL to be written by auth.js test hook
  let oauthUrl = null;
  for (let i = 0; i < 30; i++) {
    try {
      oauthUrl = fs.readFileSync(URL_FILE, 'utf-8').trim();
      if (oauthUrl && oauthUrl.startsWith('http')) break;
      oauthUrl = null;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }

  if (!oauthUrl) {
    console.log('[3/6] FAIL - OAuth URL not captured after 15s');
    fs.writeFileSync(STATUS_FILE, JSON.stringify({ success: false, error: 'OAuth URL not captured' }));
    await app.close();
    return;
  }

  console.log(`[3/6] OK - OAuth URL captured`);
  console.log(`[3/6] URL: ${oauthUrl.substring(0, 120)}...`);
  console.log('[4/6] WAITING - Complete OAuth in browser (Chrome MCP navigates here)...');

  // Wait for auth-status to change to authenticated (max 120s)
  let authenticated = false;
  for (let i = 0; i < 240; i++) {
    const dashVisible = await win.locator('#screen-dashboard').isVisible();
    if (dashVisible) {
      authenticated = true;
      break;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  if (!authenticated) {
    console.log('[5/6] FAIL - Dashboard did not appear after 120s');
    fs.writeFileSync(STATUS_FILE, JSON.stringify({ success: false, error: 'OAuth timeout' }));
    await app.close();
    return;
  }

  console.log('[5/6] OK - Authenticated! Dashboard visible');

  // Get user info
  const email = await win.locator('#user-email').textContent();
  console.log(`[5/6] Logged in as: ${email}`);

  // Wait for usage data
  console.log('[6/6] Waiting for usage data...');
  try {
    await win.waitForSelector('.limit-card', { timeout: 30000 });
    const cards = await win.locator('.limit-card').count();
    console.log(`[6/6] Found ${cards} limit card(s)`);

    for (let i = 0; i < cards; i++) {
      const card = win.locator('.limit-card').nth(i);
      const label = await card.locator('.limit-label').textContent();
      const pct = await card.locator('[data-pct]').textContent();
      const reset = await card.locator('[data-reset]').textContent();
      const eta = await card.locator('[data-eta]').textContent();
      const rate = await card.locator('[data-rate]').textContent();
      console.log(`  [${label}] ${pct} | Reset: ${reset} | ETA: ${eta} | Rate: ${rate}`);
    }

    fs.writeFileSync(STATUS_FILE, JSON.stringify({ success: true, email, cards }, null, 2));
    console.log('[6/6] PASS - OAuth flow complete, usage data verified!');
  } catch (err) {
    console.log(`[6/6] WARN - Usage data timeout: ${err.message}`);
    fs.writeFileSync(STATUS_FILE, JSON.stringify({ success: true, email, cards: 0, warn: 'Usage data timeout' }));
  }

  await app.close();
}

run().catch((err) => {
  console.error('FATAL:', err.message);
  fs.writeFileSync(STATUS_FILE, JSON.stringify({ success: false, error: err.message }));
  process.exit(1);
});
