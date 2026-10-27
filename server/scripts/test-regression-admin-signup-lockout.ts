import assert from 'assert';
import fs from 'fs';
import path from 'path';

/**
 * Regression Test: Secure Admin Signup and Dashboard Route Guarding
 * Verifies:
 * 1. Public signup UI removes the Admin role option.
 * 2. Public signups cannot self-assign role='admin' via client metadata.
 * 3. AuthContext does not trust user_metadata.role === 'admin'.
 * 4. Server verifyToken does not trust user_metadata.role === 'admin'.
 * 5. Database trigger 0008 enforces admin privileges exclusively for super-admins.
 */

async function run() {
  console.log('\n--- Running Regression Test: Secure Admin Signup and Dashboard Guarding ---');
  let passed = 0;

  const repoRoot = path.resolve(__dirname, '../..');
  // 1. Check SignupPage.tsx
  const signupPath = path.resolve(repoRoot, 'client/src/features/auth/SignupPage.tsx');
  const signupContent = fs.readFileSync(signupPath, 'utf8');

  // Verify Admin card is removed from role selection radio
  assert.strictEqual(
    signupContent.includes("id=\"role-admin\""),
    false,
    'SignupPage must not contain Admin radio card option'
  );
  assert.strictEqual(
    signupContent.includes("grid-cols-2"),
    true,
    'SignupPage must use 2-column grid for Student and Teacher roles only'
  );
  assert.strictEqual(
    signupContent.includes("cleanEmail === 'sakshivavale9@gmail.com' || cleanEmail === 'support@gmail.com'"),
    true,
    'SignupPage must restrict role assignment to authorized super-admins'
  );
  console.log('✓ PASS: Public signup UI role selector and client submit handler hardened');
  passed += 2;

  // 2. Check AuthContext.tsx
  const authContextPath = path.resolve(repoRoot, 'client/src/context/AuthContext.tsx');
  const authContextContent = fs.readFileSync(authContextPath, 'utf8');

  assert.strictEqual(
    authContextContent.includes("(user?.user_metadata?.role || '').toLowerCase() === 'admin'"),
    false,
    'AuthContext must never grant isAdmin based on client user_metadata.role'
  );
  assert.strictEqual(
    authContextContent.includes("emailLower === 'support@gmail.com'") &&
    authContextContent.includes("emailLower === 'sakshivavale9@gmail.com'"),
    true,
    'AuthContext must verify admin status via super-admin emails or server profile'
  );
  console.log('✓ PASS: Client AuthContext rejects untrusted client-supplied metadata admin roles');
  passed += 2;

  // 3. Check server/src/lib/supabase.ts
  const supabaseLibPath = path.resolve(repoRoot, 'server/src/lib/supabase.ts');
  const supabaseLibContent = fs.readFileSync(supabaseLibPath, 'utf8');

  assert.strictEqual(
    supabaseLibContent.includes("user.user_metadata?.role === 'admin'"),
    false,
    'server/src/lib/supabase.ts verifyToken must never trust user.user_metadata.role === admin'
  );
  assert.strictEqual(
    supabaseLibContent.includes("isHardcodedAdmin") && supabaseLibContent.includes("dbRoleLower === 'admin'"),
    true,
    'server/src/lib/supabase.ts must enforce admin role from database profile or super-admin emails'
  );
  console.log('✓ PASS: Server verifyToken rejects client-forged metadata admin roles');
  passed += 2;

  // 4. Check migration 0008_secure_admin_role_enforcement.sql
  const migrationPath = path.resolve(repoRoot, 'supabase/migrations/0008_secure_admin_role_enforcement.sql');
  const migrationExists = fs.existsSync(migrationPath);
  assert.strictEqual(migrationExists, true, '0008_secure_admin_role_enforcement.sql must exist');
  const migrationContent = fs.readFileSync(migrationPath, 'utf8');
  assert.strictEqual(
    migrationContent.includes("v_role := 'student'"),
    true,
    'Database trigger must force unapproved admin signups to student'
  );
  assert.strictEqual(
    migrationContent.includes("support@gmail.com") && migrationContent.includes("sakshivavale9@gmail.com"),
    true,
    'Database trigger must preserve authorized super-admin access'
  );
  console.log('✓ PASS: Database trigger migration strictly enforces student default and super-admin validation');
  passed += 3;

  console.log(`\nAll ${passed} admin lockout regression assertions PASSED!\n`);
}

run().catch((err) => {
  console.error('Admin lockout regression test failed:', err);
  process.exit(1);
});
