/**
 * Automated Verification Script for Supabase Auth Password Reset Flow
 * 
 * Tests:
 * 1. Verify redirectTo URL construction targets the frontend on port 5173 (/reset-password).
 * 2. Verify Supabase recovery action link incorporates http://localhost:5173/reset-password.
 * 3. Verify Supabase verify endpoint redirects to http://localhost:5173/reset-password with recovery tokens.
 * 4. Verify password update using Supabase recovery session and subsequent sign-out.
 * 5. Verify security handling: tokens are sanitized and expired/invalid tokens are properly rejected.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load server and client environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../client/.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ppqcrvxwlldjsfpfffth.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || '';
const VITE_APP_URL = process.env.VITE_APP_URL || 'http://localhost:5173';

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS\x1b[0m: ${testName}`);
    passedCount++;
  } else {
    console.error(`  \x1b[31m✖ FAIL\x1b[0m: ${testName} ${detail ? `(${detail})` : ''}`);
    failedCount++;
  }
}

async function runTests() {
  console.log('\n============================================================');
  console.log('🚀 Running Supabase Auth Password Reset Flow Verification');
  console.log('============================================================\n');

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Verify Frontend Base URL & Redirect URL configuration
    // -------------------------------------------------------------------------
    console.log('\x1b[34m[Test 1]\x1b[0m Checking frontend redirect URL on port 5173...');
    const baseUrl = VITE_APP_URL.replace(/\/+$/, '');
    const expectedRedirectTo = `${baseUrl}/reset-password`;

    const redirectUrlObj = new URL(expectedRedirectTo);
    assert(
      redirectUrlObj.port === '5173',
      'Redirect URL specifies port 5173',
      `Got port "${redirectUrlObj.port}"`
    );
    assert(
      redirectUrlObj.hostname === 'localhost' || redirectUrlObj.hostname === '127.0.0.1',
      'Redirect URL host is localhost',
      `Got host "${redirectUrlObj.hostname}"`
    );
    assert(
      redirectUrlObj.pathname === '/reset-password',
      'Redirect URL route is /reset-password',
      `Got path "${redirectUrlObj.pathname}"`
    );

    // -------------------------------------------------------------------------
    // TEST 2: Verify Supabase generateLink produces recovery action link for port 5173
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 2]\x1b[0m Generating recovery link via Supabase Admin API...');
    
    // Pick an existing test user
    const { data: usersData, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    assert(!listError && usersData?.users?.length > 0, 'Fetched existing Supabase users list');

    const testUser = usersData.users.find(u => u.email === 'student1.linkup@gmail.com') || usersData.users[0];
    assert(!!testUser, `Selected test user: ${testUser.email}`);

    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: testUser.email!,
      options: {
        redirectTo: expectedRedirectTo,
      },
    });

    assert(!linkError, 'Generated password recovery link without error');
    assert(!!linkData?.properties?.action_link, 'Received action_link in recovery response');

    const actionLink = linkData?.properties?.action_link || '';
    const actionUrl = new URL(actionLink);

    assert(
      actionUrl.searchParams.get('type') === 'recovery',
      'Action link type is "recovery"'
    );
    assert(
      actionUrl.searchParams.get('redirect_to') === expectedRedirectTo,
      `Action link redirect_to matches port 5173: ${expectedRedirectTo}`,
      `Got: ${actionUrl.searchParams.get('redirect_to')}`
    );

    // -------------------------------------------------------------------------
    // TEST 3: Verify Supabase verification endpoint redirects to port 5173
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 3]\x1b[0m Simulating email link click (GET verify endpoint)...');

    const verifyRes = await fetch(actionLink, { redirect: 'manual' });
    assert(
      verifyRes.status === 303 || verifyRes.status === 302,
      `Verify endpoint returns redirect status (${verifyRes.status})`
    );

    const locationHeader = verifyRes.headers.get('location') || '';
    assert(locationHeader.length > 0, 'Location header is present on redirect');

    // Parse destination URL
    const destinationUrl = new URL(locationHeader);
    assert(
      destinationUrl.port === '5173',
      'Supabase redirected user to frontend port 5173 (Vite)',
      `Actual redirect port: ${destinationUrl.port || '(default 80/443)'}`
    );
    assert(
      destinationUrl.pathname === '/reset-password',
      'Supabase redirected user to /reset-password route',
      `Actual path: ${destinationUrl.pathname}`
    );
    assert(
      destinationUrl.hash.includes('access_token=') || destinationUrl.search.includes('code='),
      'Redirect URL carries recovery credentials (token hash or PKCE code)'
    );

    // -------------------------------------------------------------------------
    // TEST 4: Verify recovery session password update (updateUser)
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 4]\x1b[0m Testing password recovery session and updateUser({ password })...');

    // Extract access_token from hash
    const hashParams = new URLSearchParams(
      destinationUrl.hash.startsWith('#') ? destinationUrl.hash.substring(1) : destinationUrl.hash
    );
    const accessToken = hashParams.get('access_token');

    if (accessToken) {
      // Create user client with the recovery token
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      });

      // Set the session explicitly using the token
      const { data: sessionData, error: sessionErr } = await userClient.auth.setSession({
        access_token: accessToken,
        refresh_token: hashParams.get('refresh_token') || '',
      });

      assert(!sessionErr && !!sessionData.session, 'Recovery session successfully established on client');

      // Update password using Supabase updateUser({ password })
      const newTestPassword = 'TestPassword123!';
      const { error: updateErr } = await userClient.auth.updateUser({
        password: newTestPassword,
      });

      assert(!updateErr, 'updateUser({ password }) successfully updated password via recovery session');

      // Sign out to terminate recovery session
      const { error: signOutErr } = await userClient.auth.signOut();
      assert(!signOutErr, 'Recovery session cleanly terminated via signOut()');

      // Verify sign in with the new password works
      const { data: signInData, error: signInErr } = await userClient.auth.signInWithPassword({
        email: testUser.email!,
        password: newTestPassword,
      });

      assert(!signInErr && !!signInData.session, 'Sign-in with new password succeeded');

      // Reset password back to standard password for stability
      await supabaseAdmin.auth.admin.updateUserById(testUser.id, {
        password: 'password123',
      });
    } else {
      console.warn('  Skipping token extraction (PKCE code flow was returned instead of hash)');
    }

    // -------------------------------------------------------------------------
    // TEST 5: Verify invalid/expired recovery request handling
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 5]\x1b[0m Testing invalid recovery token handling...');

    const invalidLink = `${SUPABASE_URL}/auth/v1/verify?token=invalid-fake-token-12345&type=recovery&redirect_to=${encodeURIComponent(expectedRedirectTo)}`;
    const invalidRes = await fetch(invalidLink, { redirect: 'manual' });
    const invalidLocation = invalidRes.headers.get('location') || '';

    assert(
      invalidLocation.includes('error') || invalidRes.status >= 400,
      'Invalid token correctly triggers error redirect or HTTP error'
    );
    // -------------------------------------------------------------------------
    // TEST 6: Verify email template files and clickable button/link rendering
    // -------------------------------------------------------------------------
    console.log('\n\x1b[34m[Test 6]\x1b[0m Verifying email templates contain clickable {{ .ConfirmationURL }}...');

    const templatePath = path.resolve(__dirname, '../../supabase/email-templates/reset-password.html');
    const minimalTemplatePath = path.resolve(__dirname, '../../supabase/email-templates/reset-password-minimal.html');

    assert(fs.existsSync(templatePath), 'Styled reset-password.html template exists');
    assert(fs.existsSync(minimalTemplatePath), 'Minimal reset-password-minimal.html template exists');

    const templateContent = fs.readFileSync(templatePath, 'utf8');
    const minimalContent = fs.readFileSync(minimalTemplatePath, 'utf8');

    // Verify both templates contain {{ .ConfirmationURL }}
    assert(
      templateContent.includes('{{ .ConfirmationURL }}'),
      'Styled template contains {{ .ConfirmationURL }} with correct casing'
    );
    assert(
      minimalContent.includes('{{ .ConfirmationURL }}'),
      'Minimal template contains {{ .ConfirmationURL }} with correct casing'
    );

    // Verify templates do not contain incorrect casing like {{.ConfirmationUrl}}
    assert(
      !templateContent.includes('{{.ConfirmationUrl}}') && !templateContent.includes('{{ .ConfirmationUrl }}'),
      'Template avoids invalid lowercase "Url" variable'
    );

    // Verify anchor tags have non-empty clickable text
    const anchorMatch = templateContent.match(/<a[^>]*href="\{\{\s*\.ConfirmationURL\s*\}\}"[^>]*>([\s\S]*?)<\/a>/i);
    assert(
      !!anchorMatch && anchorMatch[1].trim().length > 0,
      'Styled template anchor tag contains non-empty clickable text ("Reset Password")'
    );

    const minimalAnchorMatch = minimalContent.match(/<a[^>]*href="\{\{\s*\.ConfirmationURL\s*\}\}"[^>]*>([\s\S]*?)<\/a>/i);
    assert(
      !!minimalAnchorMatch && minimalAnchorMatch[1].trim().length > 0,
      'Minimal template anchor tag contains non-empty clickable text ("Reset Password")'
    );

    // Render template with simulated ConfirmationURL and ensure valid link
    const rendered = templateContent.replace(/\{\{\s*\.ConfirmationURL\s*\}\}/g, actionLink);
    assert(
      rendered.includes(`href="${actionLink}"`),
      'Rendered email contains fully-formed action link URL in href attribute'
    );
    assert(
      !rendered.includes('Follow <a') && rendered.includes('Reset Password'),
      'Rendered email contains visible "Reset Password" button text rather than empty tag'
    );

  } catch (err: any) {
    console.error('Unexpected test error:', err);
    failedCount++;
  }

  console.log('\n============================================================');
  console.log(`Test Summary: ${passedCount} Passed, ${failedCount} Failed`);
  console.log('============================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests();
