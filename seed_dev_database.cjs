const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function seed() {
  console.log('Seeding fresh development database...');

  // 1. Password Hash for password123
  const hash = await bcrypt.hash('password123', 10);
  const teacherId = 'usr-mvcg18w3-1vsgf';
  const teacherEmail = 'profiejack@gmail.com';

  // 2. Insert Faculty User
  const facultyUser = {
    id: teacherId,
    name: 'Romel Cabiling',
    email: teacherEmail,
    role: 'teacher',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    title: 'Assistant Professor & Faculty Instructor',
    department: 'College of Computing Studies',
    must_change_password: false,
  };

  const { error: userErr } = await supabase.from('users').upsert(facultyUser, { onConflict: 'id' });
  if (userErr) console.error('Error upserting teacher:', userErr.message);
  else console.log('✓ Upserted faculty user: Romel Cabiling (profiejack@gmail.com)');

  // 3. Update Credential Vault in grading_matrix_templates
  const { data: vaultRecord } = await supabase
    .from('grading_matrix_templates')
    .select('matrix')
    .eq('id', 'sys-auth-vault')
    .maybeSingle();

  let vault = (vaultRecord && Array.isArray(vaultRecord.matrix)) ? vaultRecord.matrix : [];
  
  // Upsert Romel Cabiling in vault
  const idx = vault.findIndex(v => v.userId === teacherId || v.email?.toLowerCase() === teacherEmail.toLowerCase());
  const entry = {
    userId: teacherId,
    email: teacherEmail,
    passwordHash: hash,
    mustChange: false,
  };
  if (idx >= 0) vault[idx] = entry;
  else vault.push(entry);

  // Ensure Dean credentials in vault
  if (!vault.some(v => v.email === 'rommel.constantino@gradely.edu')) {
    vault.push({
      userId: 'dean-rommel-constantino',
      email: 'rommel.constantino@gradely.edu',
      passwordHash: hash,
      mustChange: false,
    });
  }

  const { error: vaultErr } = await supabase
    .from('grading_matrix_templates')
    .upsert({ id: 'sys-auth-vault', name: '__auth_vault__', matrix: vault }, { onConflict: 'id' });
  if (vaultErr) console.error('Error updating vault:', vaultErr.message);
  else console.log('✓ Updated credential vault with teacher & dean passwords (password: password123)');

  // 4. Insert Sections
  const sections = [
    {
      id: 'sec-mvcg2yop',
      name: 'BSIT - 21001',
      grade_level_or_year: '2nd Year College',
      academic_year: '2025-2026',
      semester: '1st Semester',
      room: 'MV208',
      description: `[adviser:${teacherId}] Standard Lecture/Lab Cohort`,
    },
    {
      id: 'sec-mvddf8yj',
      name: 'BSIT-21002',
      grade_level_or_year: '2nd Year College',
      academic_year: '2025-2026',
      semester: '1st Semester',
      room: 'MV208',
      description: `[adviser:${teacherId}] Standard Lecture/Lab Cohort`,
    },
    {
      id: 'sec-mvdkxmw8',
      name: 'BSIT - 21003',
      grade_level_or_year: '2nd Year College',
      academic_year: '2025-2026',
      semester: '1st Semester',
      room: 'MV208',
      description: `[adviser:${teacherId}] Standard Lecture/Lab Cohort`,
    },
    {
      id: 'sec-mvf9kxyh',
      name: 'BSIT - 21007',
      grade_level_or_year: '2nd Year College',
      academic_year: '2025-2026',
      semester: '1st Semester',
      room: 'MV208',
      description: `[adviser:${teacherId}] Standard Lecture/Lab Cohort`,
    },
    {
      id: 'sec-mvf420sw',
      name: 'BSIT - 21008',
      grade_level_or_year: '2nd Year College',
      academic_year: '2025-2026',
      semester: '1st Semester',
      room: 'MV208',
      description: `[adviser:${teacherId}] Standard Lecture/Lab Cohort`,
    },
    {
      id: 'sec-mvdwqeyo',
      name: 'BSIT - 21009',
      grade_level_or_year: '2nd Year College',
      academic_year: '2025-2026',
      semester: '1st Semester',
      room: 'MV208',
      description: `[adviser:${teacherId}] Standard Lecture/Lab Cohort`,
    },
    {
      id: 'sec-mvm85dnx',
      name: 'BSIT - 21010',
      grade_level_or_year: '2nd Year College',
      academic_year: '2025-2026',
      semester: '1st Semester',
      room: 'MV304',
      description: 'HCI Specialization Cohort',
    },
    {
      id: 'sec-mvdvlyq9',
      name: 'BSIT - 22001',
      grade_level_or_year: '2nd Year College',
      academic_year: '2025-2026',
      semester: '2nd Semester',
      room: 'MV208',
      description: 'Octoberian Bridging Cohort',
    },
  ];

  const { error: secErr } = await supabase.from('sections').upsert(sections, { onConflict: 'id' });
  if (secErr) console.error('Error upserting sections:', secErr.message);
  else console.log(`✓ Upserted ${sections.length} sections`);

  // 5. Insert Subjects
  const defaultMatrix = [
    { id: 'cat-1', name: 'Class Standing', color: 'emerald', weight: 35, description: 'Attendance (10%), Written Works (40%), Performance Tasks (50%)' },
    { id: 'cat-2', name: 'Project (CBO)', color: 'indigo', weight: 40, description: 'Course-based Outputs (100%)' },
    { id: 'cat-3', name: 'Examination (WE)', color: 'rose', weight: 25, description: 'Periodic Written Examination (100%)' },
  ];

  const subjects = [
    {
      id: 'subj-mvcg40z3',
      section_id: 'sec-mvcg2yop',
      teacher_id: teacherId,
      name: 'Integrative Programming Technologies',
      code: 'IPT101',
      units: 3,
      passing_grade: 75,
      matrix: defaultMatrix,
      schedule: [
        { mode: 'f2f', day: 'Monday', startTime: '08:00 AM', endTime: '09:00 AM', room: 'MV208' },
        { mode: 'online', day: 'Wednesday', startTime: '08:00 AM', endTime: '09:00 AM', meetingUrl: 'https://meet.google.com' },
        { mode: 'f2f', day: 'Friday', startTime: '08:00 AM', endTime: '09:00 AM', room: 'MV208' },
      ],
    },
    {
      id: 'subj-mvkukx5n',
      section_id: 'sec-mvcg2yop',
      teacher_id: teacherId,
      name: 'IT Elective 1',
      code: 'ITE1',
      units: 3,
      passing_grade: 75,
      matrix: defaultMatrix,
      schedule: [
        { mode: 'f2f', day: 'Monday', startTime: '10:00 AM', endTime: '11:30 AM', room: 'MV208' },
        { mode: 'online', day: 'Wednesday', startTime: '10:00 AM', endTime: '11:30 AM', meetingUrl: 'https://meet.google.com' },
      ],
    },
    {
      id: 'subj-mvddgh1c',
      section_id: 'sec-mvddf8yj',
      teacher_id: teacherId,
      name: 'Integrative Programming Technologies',
      code: 'IPT101',
      units: 3,
      passing_grade: 75,
      matrix: defaultMatrix,
      schedule: [
        { mode: 'f2f', day: 'Monday', startTime: '10:00 AM', endTime: '11:30 AM', room: 'MV208' },
        { mode: 'online', day: 'Wednesday', startTime: '10:00 AM', endTime: '11:30 AM', meetingUrl: 'https://meet.google.com' },
      ],
    },
    {
      id: 'subj-mvdkyd28',
      section_id: 'sec-mvdkxmw8',
      teacher_id: teacherId,
      name: 'Integrative Programming Technologies',
      code: 'IPT101',
      units: 3,
      passing_grade: 75,
      matrix: defaultMatrix,
      schedule: [
        { mode: 'f2f', day: 'Tuesday', startTime: '08:00 AM', endTime: '10:00 AM', room: 'MV208' },
      ],
    },
    {
      id: 'subj-mvdvne1v',
      section_id: 'sec-mvdvlyq9',
      teacher_id: teacherId,
      name: 'Advance Web Platform',
      code: 'WEB101',
      units: 3,
      passing_grade: 75,
      matrix: defaultMatrix,
      schedule: [
        { mode: 'f2f', day: 'Tuesday', startTime: '01:00 PM', endTime: '03:00 PM', room: 'MV208' },
      ],
    },
    {
      id: 'subj-mvdwvx4l',
      section_id: 'sec-mvdwqeyo',
      teacher_id: teacherId,
      name: 'Integrative Programming Technologies',
      code: 'IPT101',
      units: 3,
      passing_grade: 75,
      matrix: defaultMatrix,
      schedule: [
        { mode: 'f2f', day: 'Wednesday', startTime: '01:00 PM', endTime: '03:00 PM', room: 'MV208' },
      ],
    },
    {
      id: 'subj-mvf4cwxf',
      section_id: 'sec-mvf420sw',
      teacher_id: teacherId,
      name: 'Integrative Programming Technologies',
      code: 'IPT101',
      units: 3,
      passing_grade: 75,
      matrix: defaultMatrix,
      schedule: [
        { mode: 'f2f', day: 'Thursday', startTime: '08:00 AM', endTime: '10:00 AM', room: 'MV208' },
      ],
    },
    {
      id: 'subj-mvf9lcoz',
      section_id: 'sec-mvf9kxyh',
      teacher_id: teacherId,
      name: 'Integrative Programming Technologies',
      code: 'IPT101',
      units: 3,
      passing_grade: 75,
      matrix: defaultMatrix,
      schedule: [
        { mode: 'f2f', day: 'Friday', startTime: '10:00 AM', endTime: '12:00 PM', room: 'MV208' },
      ],
    },
    {
      id: 'subj-mvm85v6o',
      section_id: 'sec-mvm85dnx',
      teacher_id: teacherId,
      name: 'Human Computer Interaction',
      code: 'HCI101',
      units: 3,
      passing_grade: 75,
      matrix: defaultMatrix,
      schedule: [
        { mode: 'f2f', day: 'Saturday', startTime: '08:00 AM', endTime: '11:00 AM', room: 'MV304' },
      ],
    },
  ];

  const { error: subErr } = await supabase.from('subjects').upsert(subjects, { onConflict: 'id' });
  if (subErr) console.error('Error upserting subjects:', subErr.message);
  else console.log(`✓ Upserted ${subjects.length} subjects`);

  // 6. Insert Assessments
  const assessments = [
    {
      id: 'ass-perf-1',
      subject_id: 'subj-mvcg40z3',
      category_id: 'cat-1',
      title: 'Performance Task 1',
      period: 'prelim',
      max_score: 100,
      date: '2026-10-18',
    },
    {
      id: 'ass-exam-1',
      subject_id: 'subj-mvcg40z3',
      category_id: 'cat-3',
      title: 'Prelim Written Examination',
      period: 'prelim',
      max_score: 50,
      date: '2026-10-18',
    },
    {
      id: 'ass-proj-1',
      subject_id: 'subj-mvcg40z3',
      category_id: 'cat-2',
      title: 'Project Output 1',
      period: 'prelim',
      max_score: 100,
      date: '2026-10-18',
    },
    {
      id: 'ass-work-2',
      subject_id: 'subj-mvcg40z3',
      category_id: 'cat-1',
      title: 'Written Work 2',
      period: 'prelim',
      max_score: 25,
      date: '2026-10-18',
    },
  ];

  const { error: assErr } = await supabase.from('assessments').upsert(assessments, { onConflict: 'id' });
  if (assErr) console.error('Error upserting assessments:', assErr.message);
  else console.log(`✓ Upserted ${assessments.length} assessments`);

  // 7. Insert Representative Students for Section BSIT - 21001
  const studentNames = [
    'Shawn Daniel Abayon', 'Mark Gabriel Ajoc', 'Jayson Brizuela', 'Emie Rose Burgonio',
    'Seanb Butal', 'Ma Grace Cainoy', 'Majelyn Calixtro', 'Catherine Cardaño',
    'Michael Vincent Cariño', 'John Zedric Fabro', 'Rubylen Mae Gabuay', 'Frinze James Gines',
    'Fatak Hajie Rakim', 'Jury Arbis', 'John Carlo Babaran', 'Kassirine Bryce Bañares',
    'John Riel Banay', 'Jaysel Belleza', 'Xena Lewis Belmi', 'John Lloyd Benitez',
    'Adam Von Hisona', 'Gunther Huab', 'Denver Ibañez', 'Dranreb Ibañez',
    'Janelle Faye Lancero', 'Kathleen Joy Landoy', 'Silvino Lastimoso', 'Mark Jenrix Lloren',
    'Christian Jay Arambulo', 'Kyle Benin Millante', 'Danilo Morato', 'Reynaliza Natial',
    'Vince Christopher Nunez', 'Lyza Kate Obida', 'Ritchie Paul Orbe', 'Jason Portugal',
    'Hubert Quintana', 'Eugene Regaspi', 'Jasper Arenas', 'Jeysabel Baring',
    'Princess Rocel Barotillo', 'Lance Gabriel Barrientos', 'Chris Adrian Bathan', 'Gil Bernadas',
    'Gieremy Rivero', 'Limuell Ruzol', 'Andrew Saldivia', 'Zyra Mae Sanchez', 'Cloud Gian Santos'
  ];

  const students = studentNames.map((name, i) => {
    const studentNumber = String(250100000 + i + 1);
    const id = `stud-dev-${i + 1}`;
    const email = `${name.toLowerCase().replace(/[^a-z0-9]/g, '.')}@student.gradely.edu`;
    return {
      id,
      name,
      email,
      role: 'student',
      student_number: studentNumber,
      section_id: 'sec-mvcg2yop',
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`,
      must_change_password: true,
    };
  });

  const { error: studErr } = await supabase.from('users').upsert(students, { onConflict: 'id' });
  if (studErr) console.error('Error upserting students:', studErr.message);
  else console.log(`✓ Upserted ${students.length} students into BSIT - 21001`);

  console.log('Seeding complete! Development database is fully populated and ready.');
}

seed().catch(console.error);
