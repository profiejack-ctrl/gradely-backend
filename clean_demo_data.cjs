const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function cleanDemoData() {
  console.log('Cleaning seeded demo records from Supabase dev database...');

  // 1. Delete score records
  const { error: errScores } = await supabase.from('score_records').delete().neq('id', 'keep-none');
  if (errScores) console.warn('Scores delete note:', errScores.message);
  else console.log('✓ Cleared score_records');

  // 2. Delete attendance records
  const { error: errAtt } = await supabase.from('attendance_records').delete().neq('id', 'keep-none');
  if (errAtt) console.warn('Attendance delete note:', errAtt.message);
  else console.log('✓ Cleared attendance_records');

  // 3. Delete assessments
  const { error: errAss } = await supabase.from('assessments').delete().neq('id', 'keep-none');
  if (errAss) console.warn('Assessments delete note:', errAss.message);
  else console.log('✓ Cleared assessments');

  // 4. Delete subjects
  const { error: errSub } = await supabase.from('subjects').delete().neq('id', 'keep-none');
  if (errSub) console.warn('Subjects delete note:', errSub.message);
  else console.log('✓ Cleared subjects');

  // 5. Delete sections
  const { error: errSec } = await supabase.from('sections').delete().neq('id', 'keep-none');
  if (errSec) console.warn('Sections delete note:', errSec.message);
  else console.log('✓ Cleared sections');

  // 6. Delete seeded student users (preserving teachers and deans)
  const { error: errUsers } = await supabase.from('users').delete().eq('role', 'student');
  if (errUsers) console.warn('Student users delete note:', errUsers.message);
  else console.log('✓ Cleared seeded demo student users (kept faculty & dean accounts)');

  console.log('Cleanup complete. The development database is now completely clean.');
}

cleanDemoData().catch(console.error);
