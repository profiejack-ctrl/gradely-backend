"use strict";
const fs = require('fs');
const dotenvPath = 'C:/Users/ProfieJack/Desktop/gradely-backend/gradely-backend/.env';
if (fs.existsSync(dotenvPath)) {
    const content = fs.readFileSync(dotenvPath, 'utf8');
    content.split('\n').forEach(line => {
        const parts = line.trim().split('=');
        if (parts.length >= 2) {
            process.env[parts[0].trim()] = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
        }
    });
}
const bcrypt = require('C:/Users/ProfieJack/Desktop/gradely-backend/gradely-backend/node_modules/bcryptjs');
const { supabase } = require('C:/Users/ProfieJack/Desktop/gradely-backend/gradely-backend/dist/lib/supabase.js');
const { getVault, saveVault } = require('C:/Users/ProfieJack/Desktop/gradely-backend/gradely-backend/dist/lib/authVault.js');
async function clearDatabase() {
    console.log('--- Starting Database Clear ---');
    // 1. Wipe score_records
    const { count: scoresCount, error: scoresErr } = await supabase.from('score_records').delete().not('id', 'is', null);
    console.log('1. Cleared score_records:', scoresErr ? scoresErr.message : 'OK');
    // 2. Wipe attendance_records
    const { error: attErr } = await supabase.from('attendance_records').delete().not('id', 'is', null);
    console.log('2. Cleared attendance_records:', attErr ? attErr.message : 'OK');
    // 3. Wipe assessments
    const { error: assErr } = await supabase.from('assessments').delete().not('id', 'is', null);
    console.log('3. Cleared assessments:', assErr ? assErr.message : 'OK');
    // 4. Wipe subjects
    const { error: subErr } = await supabase.from('subjects').delete().not('id', 'is', null);
    console.log('4. Cleared subjects:', subErr ? subErr.message : 'OK');
    // 5. Wipe sections
    const { error: secErr } = await supabase.from('sections').delete().not('id', 'is', null);
    console.log('5. Cleared sections:', secErr ? secErr.message : 'OK');
    // 6. Wipe non-dean users from public.users
    const { data: nonDeans, error: nonDeansErr } = await supabase
        .from('users')
        .select('id, email, role, name')
        .neq('role', 'dean');
    console.log(`Found ${nonDeans?.length || 0} non-dean users to delete (students & non-dean faculty).`);
    const { error: userDelErr } = await supabase
        .from('users')
        .delete()
        .neq('role', 'dean');
    console.log('6. Deleted non-dean users from public.users:', userDelErr ? userDelErr.message : 'OK');
    // 7. Delete orphaned users from Supabase Auth (auth.users)
    const { data: authUsers } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
    let deletedAuthCount = 0;
    if (authUsers?.users) {
        for (const u of authUsers.users) {
            const email = u.email?.toLowerCase() || '';
            const isDean = email === 'dean@gradely.edu' || email === 'rommel.constantino@gradely.edu' || u.user_metadata?.role === 'dean';
            if (!isDean) {
                await supabase.auth.admin.deleteUser(u.id);
                deletedAuthCount++;
            }
        }
    }
    console.log(`7. Deleted ${deletedAuthCount} non-dean users from Supabase Auth.`);
    // 8. Ensure dean account exists and is properly configured in Supabase Auth & public.users
    const deanEmail = 'dean@gradely.edu';
    const defaultDeanPassword = 'password123';
    const passwordHash = await bcrypt.hash(defaultDeanPassword, 10);
    // Check or upsert in public.users
    const { data: deanUser, error: deanUserErr } = await supabase
        .from('users')
        .upsert({
        id: 'dean-admin',
        name: 'College Dean',
        email: deanEmail,
        role: 'dean',
        title: 'College Dean & Administrator',
        department: 'College of Computing Studies',
        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=DeanAdmin',
        student_number: null,
        section_id: null,
        must_change_password: false,
    }, { onConflict: 'id' })
        .select()
        .single();
    console.log('8a. Ensured dean-admin in public.users:', deanUserErr ? deanUserErr.message : deanUser?.email);
    // Also ensure Rommel Constantino dean account exists
    await supabase.from('users').upsert({
        id: 'e061f5c1-a24b-40a4-8725-72786b97ae2f',
        name: 'Rommel Constantino',
        email: 'rommel.constantino@gradely.edu',
        role: 'dean',
        title: 'College Dean',
        department: 'College of Computing Studies',
        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=RommelConstantino',
        student_number: null,
        section_id: null,
        must_change_password: false,
    }, { onConflict: 'id' });
    // Update Supabase Auth for dean accounts
    const { data: authList } = await supabase.auth.admin.listUsers();
    const existingDeanAuth = authList?.users?.find(u => u.email?.toLowerCase() === deanEmail);
    if (existingDeanAuth) {
        await supabase.auth.admin.updateUserById(existingDeanAuth.id, {
            password: defaultDeanPassword,
            user_metadata: { name: 'College Dean', role: 'dean' },
            email_confirm: true,
        });
        console.log('8b. Updated dean@gradely.edu in Supabase Auth with password123.');
    }
    else {
        await supabase.auth.admin.createUser({
            email: deanEmail,
            password: defaultDeanPassword,
            email_confirm: true,
            user_metadata: { name: 'College Dean', role: 'dean' },
        });
        console.log('8b. Created dean@gradely.edu in Supabase Auth with password123.');
    }
    // Ensure rommel in auth too
    const existingRommelAuth = authList?.users?.find(u => u.email?.toLowerCase() === 'rommel.constantino@gradely.edu');
    if (existingRommelAuth) {
        await supabase.auth.admin.updateUserById(existingRommelAuth.id, {
            password: defaultDeanPassword,
            user_metadata: { name: 'Rommel Constantino', role: 'dean' },
            email_confirm: true,
        });
    }
    else {
        await supabase.auth.admin.createUser({
            email: 'rommel.constantino@gradely.edu',
            password: defaultDeanPassword,
            email_confirm: true,
            user_metadata: { name: 'Rommel Constantino', role: 'dean' },
        });
    }
    // 9. Rebuild sys-auth-vault with dean accounts only
    const deanVault = [
        {
            userId: 'dean-admin',
            email: deanEmail,
            passwordHash,
            mustChange: false,
        },
        {
            userId: 'e061f5c1-a24b-40a4-8725-72786b97ae2f',
            email: 'rommel.constantino@gradely.edu',
            passwordHash,
            mustChange: false,
        }
    ];
    await saveVault(deanVault);
    console.log('9. Rebuilt sys-auth-vault with dean accounts only.');
    // 10. Clear audit_logs
    await supabase.from('audit_logs').delete().not('id', 'is', null);
    console.log('10. Cleared audit_logs.');
    // Verify final counts
    console.log('\n--- Verification ---');
    const { data: finalUsers } = await supabase.from('users').select('id, name, email, role');
    console.log('Remaining Users:', finalUsers);
    const { count: finalSecs } = await supabase.from('sections').select('*', { count: 'exact', head: true });
    console.log('Remaining Sections:', finalSecs);
    const { count: finalSubs } = await supabase.from('subjects').select('*', { count: 'exact', head: true });
    console.log('Remaining Subjects:', finalSubs);
    const { count: finalAss } = await supabase.from('assessments').select('*', { count: 'exact', head: true });
    console.log('Remaining Assessments:', finalAss);
}
clearDatabase().catch(console.error);
