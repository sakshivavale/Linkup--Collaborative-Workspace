const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './server/.env' });

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ppqcrvxwlldjsfpfffth.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY not found in server/.env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function seedAdmin() {
  const adminEmail = 'support@gmail.com';
  const adminPassword = '12345678';
  console.log(`Checking / provisioning admin account for: ${adminEmail}...`);

  // Check if user already exists
  const { data: usersData, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) {
    console.error('Error listing users:', listError.message);
  }

  const existing = usersData?.users?.find(
    (u) => u.email?.toLowerCase() === adminEmail.toLowerCase()
  );

  if (existing) {
    console.log(`User ${adminEmail} exists (ID: ${existing.id}). Updating password and admin metadata...`);
    const { data: updated, error: updateError } = await supabase.auth.admin.updateUserById(existing.id, {
      password: adminPassword,
      email_confirm: true,
      user_metadata: {
        full_name: 'Administrator',
        role: 'ADMIN',
        status: 'APPROVED',
        isApproved: true,
        is_approved: true,
      },
    });

    if (updateError) {
      console.error('Error updating admin:', updateError.message);
    } else {
      console.log('Admin account successfully updated!');
    }
  } else {
    console.log(`Creating new Admin user ${adminEmail}...`);
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: {
        full_name: 'Administrator',
        role: 'ADMIN',
        status: 'APPROVED',
        isApproved: true,
        is_approved: true,
      },
    });

    if (createError) {
      console.error('Error creating admin:', createError.message);
    } else {
      console.log('Admin account created successfully with ID:', created?.user?.id);
    }
  }

  // Upsert profile
  try {
    const { data: userRecord } = await supabase.auth.admin.listUsers();
    const targetUser = userRecord?.users?.find((u) => u.email?.toLowerCase() === adminEmail.toLowerCase());
    if (targetUser) {
      await supabase.from('profiles').upsert({
        id: targetUser.id,
        full_name: 'Administrator',
        role: 'admin',
        isApproved: true,
        is_approved: true,
        status: 'APPROVED',
      });
      console.log('Profiles table entry synced for admin.');
    }
  } catch (err) {
    console.warn('Note: Profile table sync notice (handled by DB trigger):', err.message);
  }

  console.log('Admin setup complete! Credentials:');
  console.log('  Username / Email: support@gmail.com');
  console.log('  Password:         12345678');
}

seedAdmin().catch(console.error);
