"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const supabase_1 = require("../lib/supabase");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const authVault_1 = require("../lib/authVault");
const helpers_1 = require("../lib/helpers");
const pagination_1 = require("../lib/pagination");
const audit_1 = require("../lib/audit");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth, auth_1.requireFaculty);
function ensureConfigured(res) {
    if (!supabase_1.isSupabaseConfigured || !supabase_1.supabase) {
        res.status(503).json({ error: 'Database not configured' });
        return false;
    }
    return true;
}
/**
 * Access check helper: Ensures teacher is assigned to the subject (or caller is Dean).
 */
async function getAuthorizedSubject(userId, role, subjectId) {
    if (!supabase_1.supabase)
        return null;
    const query = supabase_1.supabase.from('subjects').select('*').eq('id', subjectId);
    if (role !== 'dean') {
        query.eq('teacher_id', userId);
    }
    const { data } = await query.maybeSingle();
    return data;
}
/**
 * Access check helper: Ensures teacher advises or teaches in the section (or caller is Dean).
 */
async function getAuthorizedSection(userId, role, sectionId) {
    if (!supabase_1.supabase)
        return null;
    const { data: section } = await supabase_1.supabase.from('sections').select('*').eq('id', sectionId).maybeSingle();
    if (!section)
        return null;
    if (role === 'dean')
        return section;
    const decoded = (0, helpers_1.decodeSectionDescription)(section.description);
    if (decoded.adviserId === userId)
        return section;
    // Check if teacher teaches any subject in this section
    const { data: subject } = await supabase_1.supabase
        .from('subjects')
        .select('id')
        .eq('section_id', sectionId)
        .eq('teacher_id', userId)
        .limit(1)
        .maybeSingle();
    return subject ? section : null;
}
/**
 * Resolves grading matrix from template inheritance or custom subject override.
 */
function resolveSubjectMatrix(subject, template) {
    if (subject.custom_matrix && Array.isArray(subject.custom_matrix) && subject.custom_matrix.length > 0) {
        return { matrix: subject.custom_matrix, templateName: 'Custom Course Syllabus' };
    }
    if (template) {
        let matrix = template.matrix || [];
        if (matrix && !Array.isArray(matrix) && typeof matrix === 'object') {
            matrix = matrix.categories || [];
        }
        return { matrix, templateName: template.name };
    }
    if (subject.matrix) {
        let matrix = subject.matrix;
        if (!Array.isArray(matrix) && typeof matrix === 'object') {
            matrix = matrix.categories || [];
        }
        if (Array.isArray(matrix) && matrix.length > 0) {
            return { matrix, templateName: 'Direct Subject Matrix' };
        }
    }
    return {
        matrix: [
            { id: 'attendance', name: 'Attendance & Class Participation', weight: 10, isAttendance: true },
            { id: 'written_works', name: 'Quizzes & Written Works', weight: 25 },
            { id: 'performance_tasks', name: 'Laboratory & Performance Tasks', weight: 35 },
            { id: 'major_exam', name: 'Periodical Examination', weight: 30 },
        ],
        templateName: 'Standard University Matrix',
    };
}
// =============================================================================
// 1. OVERVIEW & HOME
// =============================================================================
/**
 * GET /api/faculty/overview (also /api/faculty/dashboard)
 * Lightweight teacher home screen: Today's classes, summary KPI counts.
 */
router.get(['/overview', '/dashboard'], async (req, res) => {
    if (!ensureConfigured(res))
        return;
    try {
        const isDean = req.user?.role === 'dean';
        const teacherId = req.user.userId;
        // 1. Fetch teacher's subjects
        const subjectsQuery = supabase_1.supabase.from('subjects').select('id,section_id,teacher_id,name,code,units,schedule');
        if (!isDean)
            subjectsQuery.eq('teacher_id', teacherId);
        const { data: subjects = [], error: subErr } = await subjectsQuery;
        if (subErr)
            throw subErr;
        const subjectIds = (subjects || []).map(s => s.id);
        const sectionIds = [...new Set((subjects || []).map(s => s.section_id).filter(Boolean))];
        // 2. Fetch section names & adviser sections in parallel
        const [sectionsRes, templatesRes, assessmentsRes] = await Promise.all([
            sectionIds.length ? supabase_1.supabase.from('sections').select('id,name').in('id', sectionIds) : { data: [] },
            supabase_1.supabase.from('grading_matrix_templates').select('id,name'),
            subjectIds.length ? supabase_1.supabase.from('assessments').select('id,subject_id,title,date,due_date,period').in('subject_id', subjectIds).order('date', { ascending: false }).limit(5) : { data: [] },
        ]);
        const sectionMap = new Map((sectionsRes.data || []).map(s => [s.id, s.name]));
        const templateMap = new Map((templatesRes.data || []).map(t => [t.id, t.name]));
        // 3. Resolve classes scheduled for today
        const currentDay = (0, helpers_1.getDayOfWeek)();
        const todayClasses = [];
        (subjects || []).forEach(subject => {
            const schedule = (0, helpers_1.parseSchedule)(subject.schedule);
            schedule.forEach(session => {
                if (session.day === currentDay) {
                    todayClasses.push({
                        subjectId: subject.id,
                        subjectCode: subject.code,
                        subjectName: subject.name,
                        sectionName: sectionMap.get(subject.section_id) || 'Unknown Section',
                        mode: session.mode,
                        startTime: session.startTime,
                        endTime: session.endTime,
                        room: session.room,
                        meetingUrl: session.meetingUrl,
                    });
                }
            });
        });
        todayClasses.sort((a, b) => a.startTime.localeCompare(b.startTime));
        res.json({
            teacher: {
                id: req.user.userId,
                name: req.user.name,
                email: req.user.email,
                role: req.user.role,
            },
            stats: {
                totalSubjects: (subjects || []).length,
                totalSections: sectionIds.length,
                currentDay,
            },
            todayClasses,
            recentAssessments: assessmentsRes.data || [],
        });
    }
    catch (err) {
        console.error('Faculty overview error:', err);
        res.status(500).json({ error: 'Failed to load faculty overview' });
    }
});
// =============================================================================
// 2. SUBJECTS / COURSES
// =============================================================================
/**
 * GET /api/faculty/subjects
 * Lists all subjects assigned to this teacher with section name, units, and schedule.
 */
router.get('/subjects', async (req, res) => {
    if (!ensureConfigured(res))
        return;
    try {
        const isDean = req.user?.role === 'dean';
        const query = supabase_1.supabase
            .from('subjects')
            .select('id,section_id,teacher_id,name,code,units,passing_grade,matrix,schedule');
        if (!isDean)
            query.eq('teacher_id', req.user.userId);
        const { data: rawSubjects = [], error: subErr } = await query.order('code', { ascending: true });
        // Deduplicate subjects by ID
        const uniqueMap = new Map();
        for (const s of (rawSubjects || [])) {
            if (!uniqueMap.has(s.id)) {
                uniqueMap.set(s.id, s);
            }
        }
        const deduplicatedSubjects = Array.from(uniqueMap.values());
        if (subErr)
            throw subErr;
        const sectionIds = [...new Set((deduplicatedSubjects || []).map(s => s.section_id).filter(Boolean))];
        const templateIds = [];
        const [sectionsRes, templatesRes] = await Promise.all([
            sectionIds.length ? supabase_1.supabase.from('sections').select('id,name,grade_level_or_year,semester').in('id', sectionIds) : { data: [] },
            templateIds.length ? supabase_1.supabase.from('grading_matrix_templates').select('id,name').in('id', templateIds) : { data: [] },
        ]);
        const sectionMap = new Map((sectionsRes.data || []).map(s => [s.id, s]));
        const templateMap = new Map((templatesRes.data || []).map(t => [t.id, t.name]));
        const subjects = (deduplicatedSubjects || []).map(s => {
            const section = sectionMap.get(s.section_id);
            return {
                id: s.id,
                sectionId: s.section_id,
                sectionName: section?.name || 'Unknown',
                gradeLevelOrYear: section?.grade_level_or_year || '',
                name: s.name,
                code: s.code,
                units: s.units ?? 3,
                passingGrade: s.passing_grade ?? 75,
                gradeDisplayMode: s.grade_display_mode || 'both',
                templateName: 'Standard Matrix',
                schedule: (0, helpers_1.parseSchedule)(s.schedule),
            };
        });
        res.json(subjects);
    }
    catch (err) {
        console.error('Faculty subjects error:', err);
        res.status(500).json({ error: 'Failed to load assigned subjects' });
    }
});
/**
 * GET /api/faculty/subjects/:subjectId
 * Detailed single subject view: Syllabus matrix, passing grade, display mode, and schedule.
 */
router.get('/subjects/:subjectId', async (req, res) => {
    if (!ensureConfigured(res))
        return;
    try {
        const subject = await getAuthorizedSubject(req.user.userId, req.user.role, req.params.subjectId);
        if (!subject) {
            res.status(404).json({ error: 'Subject not found or not assigned to you' });
            return;
        }
        const [sectionRes, templateRes] = await Promise.all([
            supabase_1.supabase.from('sections').select('id,name,grade_level_or_year,academic_year,semester,room').eq('id', subject.section_id).maybeSingle(),
            subject.grading_matrix_template_id
                ? supabase_1.supabase.from('grading_matrix_templates').select('id,name,matrix').eq('id', subject.grading_matrix_template_id).maybeSingle()
                : { data: null },
        ]);
        const { matrix, templateName } = resolveSubjectMatrix(subject, templateRes.data);
        res.json({
            id: subject.id,
            name: subject.name,
            code: subject.code,
            units: subject.units ?? 3,
            passingGrade: subject.passing_grade ?? 75,
            gradeDisplayMode: subject.grade_display_mode || 'both',
            templateName,
            section: sectionRes.data || null,
            matrix,
            schedule: (0, helpers_1.parseSchedule)(subject.schedule),
        });
    }
    catch (err) {
        console.error('Faculty subject detail error:', err);
        res.status(500).json({ error: 'Failed to load subject details' });
    }
});
// =============================================================================
// 3. SECTIONS & ROSTERS (ON-DEMAND)
// =============================================================================
/**
 * GET /api/faculty/sections
 * Lists sections taught or advised by the teacher.
 */
router.get('/sections', async (req, res) => {
    if (!ensureConfigured(res))
        return;
    try {
        const isDean = req.user?.role === 'dean';
        const teacherId = req.user.userId;
        let targetSectionIds = [];
        if (!isDean) {
            // Find sections where teacher teaches a subject
            const { data: teacherSubjects } = await supabase_1.supabase
                .from('subjects')
                .select('section_id')
                .eq('teacher_id', teacherId);
            const subjectSectionIds = (teacherSubjects || []).map(s => s.section_id).filter(Boolean);
            // Find sections advised by teacher
            const { data: advisedSections } = await supabase_1.supabase
                .from('sections')
                .select('id')
                .ilike('description', `%[adviser:${teacherId}]%`);
            const advisedIds = (advisedSections || []).map(s => s.id);
            targetSectionIds = [...new Set([...subjectSectionIds, ...advisedIds])];
            if (targetSectionIds.length === 0) {
                res.json([]);
                return;
            }
        }
        const sectionsQuery = supabase_1.supabase
            .from('sections')
            .select('id,name,grade_level_or_year,academic_year,semester,room,description')
            .order('name', { ascending: true });
        if (!isDean) {
            sectionsQuery.in('id', targetSectionIds);
        }
        const { data: sections = [], error } = await sectionsQuery;
        if (error)
            throw error;
        const mapped = (sections || []).map(s => {
            const decoded = (0, helpers_1.decodeSectionDescription)(s.description);
            return {
                id: s.id,
                name: s.name,
                gradeLevelOrYear: s.grade_level_or_year,
                academicYear: s.academic_year,
                semester: s.semester,
                room: s.room || undefined,
                description: decoded.description || undefined,
                isAdviser: decoded.adviserId === teacherId || isDean,
            };
        });
        res.json(mapped);
    }
    catch (err) {
        console.error('Faculty sections error:', err);
        res.status(500).json({ error: 'Failed to load sections' });
    }
});
/**
 * GET /api/faculty/sections/:sectionId/students
 * Lazy-loads student roster strictly for the requested section.
 * Only students in this section are returned!
 */
router.get('/sections/:sectionId/students', async (req, res) => {
    if (!ensureConfigured(res))
        return;
    try {
        const sectionId = req.params.sectionId;
        const section = await getAuthorizedSection(req.user.userId, req.user.role, sectionId);
        if (!section) {
            res.status(403).json({ error: 'You are not assigned to teach or advise this section' });
            return;
        }
        // Query students who have this section in their section_id
        const { data: rawStudents = [], error } = await supabase_1.supabase
            .from('users')
            .select('id,name,first_name,last_name,email,role,student_number,section_id,avatar,department,title,address,contact_number')
            .eq('role', 'student')
            .ilike('section_id', `%${sectionId}%`)
            .order('name', { ascending: true });
        if (error)
            throw error;
        // Filter in JS to strictly enforce exact section membership
        const students = (rawStudents || [])
            .filter(u => (0, helpers_1.parseSectionIds)(u.section_id).includes(sectionId))
            .map(u => {
            let firstName = u.first_name || '';
            let lastName = u.last_name || '';
            if (!firstName && !lastName && u.name) {
                const parts = String(u.name).trim().split(/\s+/);
                firstName = parts[0] || '';
                lastName = parts.slice(1).join(' ') || '';
            }
            const studentId = u.student_number || u.id;
            const avatar = u.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(u.name)}`;
            return {
                id: u.id,
                studentId,
                studentNumber: u.student_number || undefined,
                name: u.name || `${firstName} ${lastName}`.trim(),
                firstName,
                lastName,
                email: u.email,
                contactNumber: u.contact_number || undefined,
                address: u.address || undefined,
                avatar,
                profilePicture: avatar,
                department: u.department || undefined,
            };
        });
        res.json({
            section: {
                id: section.id,
                name: section.name,
                gradeLevelOrYear: section.grade_level_or_year,
            },
            count: students.length,
            students,
        });
    }
    catch (err) {
        console.error('Section students error:', err);
        res.status(500).json({ error: 'Failed to load section students' });
    }
});
/**
 * POST /api/faculty/sections/:sectionId/roster
 * Bulk enrolls students from a masterlist into the section.
 * Automatically provisions their user accounts in public.users,
 * registers their default password (their student number) in auth vault & Supabase Auth,
 * and sets mustChangePassword = true.
 */
router.post('/sections/:sectionId/roster', async (req, res) => {
    if (!ensureConfigured(res))
        return;
    try {
        const sectionId = req.params.sectionId;
        const section = await getAuthorizedSection(req.user.userId, req.user.role, sectionId);
        if (!section) {
            res.status(403).json({ error: 'You are not assigned to teach or advise this section' });
            return;
        }
        const { students } = req.body;
        if (!Array.isArray(students) || students.length === 0) {
            res.status(400).json({ error: 'No student records provided.' });
            return;
        }
        const cleanStudents = students
            .filter(s => s && s.studentNumber && String(s.studentNumber).trim() && s.name && String(s.name).trim())
            .map(s => {
            const studentNumber = String(s.studentNumber).trim();
            let name = String(s.name).trim();
            // If "Lastname, Firstname", convert to "Firstname Lastname"
            if (name.includes(',')) {
                const parts = name.split(',').map(p => p.trim());
                if (parts.length >= 2) {
                    name = `${parts[1]} ${parts[0]}`;
                }
            }
            const email = s.email && s.email.includes('@') ? s.email.trim().toLowerCase() : `${studentNumber}@gradely.edu`;
            return { studentNumber, name, email };
        });
        if (cleanStudents.length === 0) {
            res.status(400).json({ error: 'No valid student rows found (must contain Student ID and Name).' });
            return;
        }
        // 1. Fetch existing users by student_number or email
        const studentNumbers = cleanStudents.map(s => s.studentNumber);
        const emails = cleanStudents.map(s => s.email);
        const { data: existingUsers = [] } = await supabase_1.supabase
            .from('users')
            .select('id,email,student_number,section_id,role')
            .or(`student_number.in.(${studentNumbers.join(',')}),email.in.(${emails.join(',')})`);
        const existingByNumber = new Map((existingUsers || []).map(u => [String(u.student_number).trim(), u]));
        const existingByEmail = new Map((existingUsers || []).map(u => [String(u.email).toLowerCase(), u]));
        const usersToUpsert = [];
        const enrollmentsToUpsert = [];
        const vault = await (0, authVault_1.getVault)();
        let vaultUpdated = false;
        for (const stud of cleanStudents) {
            const existing = existingByNumber.get(stud.studentNumber) || existingByEmail.get(stud.email);
            let userId;
            let mergedSections;
            if (existing) {
                userId = existing.id;
                const currentSections = (0, helpers_1.parseSectionIds)(existing.section_id);
                mergedSections = currentSections.includes(sectionId) ? currentSections : [...currentSections, sectionId];
            }
            else {
                userId = `stud-${stud.studentNumber}`;
                mergedSections = [sectionId];
            }
            usersToUpsert.push({
                id: userId,
                name: stud.name,
                email: stud.email,
                student_number: stud.studentNumber,
                role: 'student',
                section_id: (0, helpers_1.formatSectionIds)(mergedSections),
                avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(stud.name)}`,
                department: section.name ? section.name.split('-')[0].trim() : 'College',
                must_change_password: true,
            });
            enrollmentsToUpsert.push({
                student_id: userId,
                section_id: sectionId,
            });
            // Ensure vault entry with default password = studentNumber
            const vaultIdx = vault.findIndex(v => v.userId === userId || v.email?.toLowerCase() === stud.email.toLowerCase());
            if (vaultIdx === -1) {
                const passwordHash = await bcryptjs_1.default.hash(stud.studentNumber, 10);
                vault.push({
                    userId,
                    email: stud.email.toLowerCase(),
                    passwordHash,
                    mustChange: true,
                });
                vaultUpdated = true;
            }
            // Provision in Supabase Auth asynchronously so student can log into separate app
            supabase_1.supabase.auth.admin.createUser({
                email: stud.email,
                password: stud.studentNumber,
                email_confirm: true,
                user_metadata: {
                    name: stud.name,
                    role: 'student',
                    student_number: stud.studentNumber,
                },
            }).catch(err => {
                if (!err.message?.includes('already been registered')) {
                    console.log(`Supabase auth student note for ${stud.email}:`, err.message);
                }
            });
        }
        // 2. Batch upsert users
        const { error: upsertErr } = await supabase_1.supabase
            .from('users')
            .upsert(usersToUpsert, { onConflict: 'id' });
        if (upsertErr)
            throw upsertErr;
        // 3. Batch upsert student_enrollments
        if (enrollmentsToUpsert.length > 0) {
            try {
                await supabase_1.supabase
                    .from('student_enrollments')
                    .upsert(enrollmentsToUpsert, { onConflict: 'student_id,section_id' });
            }
            catch (e) {
                console.warn('Enrollment record upsert note:', e?.message || e);
            }
        }
        // 4. Save vault if updated
        if (vaultUpdated) {
            await (0, authVault_1.saveVault)(vault);
        }
        res.json({
            success: true,
            enrolledCount: cleanStudents.length,
            sectionId,
            students: usersToUpsert.map(u => ({
                id: u.id,
                name: u.name,
                email: u.email,
                role: 'student',
                studentNumber: u.student_number,
                sectionId: sectionId,
                avatar: u.avatar,
            })),
        });
    }
    catch (err) {
        console.error('Upload roster error:', err);
        res.status(500).json({ error: err.message || 'Failed to upload and enroll student roster' });
    }
});
// =============================================================================
// 4. GRADEBOOK PER SUBJECT (ON-DEMAND)
// =============================================================================
/**
 * GET /api/faculty/subjects/:subjectId/gradebook
 * Lazy-loads the complete gradebook for ONE subject:
 * Enrolled students, assessments for the period, and scores.
 */
router.get('/subjects/:subjectId/gradebook', async (req, res) => {
    if (!ensureConfigured(res))
        return;
    try {
        const subject = await getAuthorizedSubject(req.user.userId, req.user.role, req.params.subjectId);
        if (!subject) {
            res.status(404).json({ error: 'Subject not found or not assigned to you' });
            return;
        }
        const requestedPeriod = typeof req.query.period === 'string' ? req.query.period : undefined;
        // 1. Fetch section & enrolled students
        const [sectionRes, rawStudentsRes] = await Promise.all([
            supabase_1.supabase.from('sections').select('id,name').eq('id', subject.section_id).maybeSingle(),
            supabase_1.supabase.from('users').select('id,name,student_number,avatar,section_id').eq('role', 'student').ilike('section_id', `%${subject.section_id}%`).order('name', { ascending: true }),
        ]);
        const students = (rawStudentsRes.data || [])
            .filter(u => (0, helpers_1.parseSectionIds)(u.section_id).includes(subject.section_id))
            .map(u => ({
            id: u.id,
            name: u.name,
            studentNumber: u.student_number || undefined,
            avatar: u.avatar || undefined,
        }));
        // 2. Fetch assessments for this subject
        const assessmentsQuery = supabase_1.supabase
            .from('assessments')
            .select('id,subject_id,category_id,period,title,max_score,date,due_date')
            .eq('subject_id', subject.id)
            .order('date', { ascending: true });
        if (requestedPeriod) {
            assessmentsQuery.eq('period', requestedPeriod);
        }
        const { data: assessments = [] } = await assessmentsQuery;
        const assessmentIds = (assessments || []).map(a => a.id);
        // 3. Fetch scores for these assessments
        const { data: scores = [] } = assessmentIds.length > 0
            ? await supabase_1.supabase
                .from('score_records')
                .select('id,assessment_id,student_id,score,remarks,submitted_at')
                .in('assessment_id', assessmentIds)
            : { data: [] };
        // Group scores by assessment_id -> student_id -> score
        const scoresByStudent = new Map();
        (scores || []).forEach(sc => {
            if (!scoresByStudent.has(sc.student_id)) {
                scoresByStudent.set(sc.student_id, new Map());
            }
            scoresByStudent.get(sc.student_id).set(sc.assessment_id, sc);
        });
        const gradebookRows = students.map(student => {
            const studentScores = scoresByStudent.get(student.id) || new Map();
            const studentAssessmentScores = {};
            (assessments || []).forEach(a => {
                const sc = studentScores.get(a.id);
                const hasScore = sc && Number.isFinite(Number(sc.score));
                const { rawPercent, transmutedGrade, hasAttempt } = (0, helpers_1.transmuteScore)(hasScore ? sc.score : undefined, a.max_score, subject.passing_grade || 75);
                studentAssessmentScores[a.id] = {
                    scoreId: sc?.id || null,
                    rawScore: hasScore ? sc.score : null,
                    maxScore: a.max_score,
                    rawPercent: hasScore ? rawPercent : 0,
                    transmutedGrade,
                    hasAttempt,
                    remarks: sc?.remarks || null,
                };
            });
            return {
                student,
                scores: studentAssessmentScores,
            };
        });
        res.json({
            subject: {
                id: subject.id,
                name: subject.name,
                code: subject.code,
                sectionName: sectionRes.data?.name || 'Unknown',
                passingGrade: subject.passing_grade ?? 75,
                gradeDisplayMode: subject.grade_display_mode || 'both',
            },
            period: requestedPeriod || 'all',
            assessments: assessments || [],
            gradebook: gradebookRows,
        });
    }
    catch (err) {
        console.error('Faculty gradebook error:', err);
        res.status(500).json({ error: 'Failed to load gradebook' });
    }
});
// =============================================================================
// 5. ATTENDANCE PER SUBJECT (ON-DEMAND)
// =============================================================================
/**
 * GET /api/faculty/subjects/:subjectId/attendance
 * Loads attendance records for ONE subject. Optional: ?date=YYYY-MM-DD or ?period=prelim.
 */
router.get('/subjects/:subjectId/attendance', async (req, res) => {
    if (!ensureConfigured(res))
        return;
    try {
        const subject = await getAuthorizedSubject(req.user.userId, req.user.role, req.params.subjectId);
        if (!subject) {
            res.status(404).json({ error: 'Subject not found or not assigned to you' });
            return;
        }
        const requestedDate = typeof req.query.date === 'string' ? req.query.date : undefined;
        const requestedPeriod = typeof req.query.period === 'string' ? req.query.period : undefined;
        // Fetch students in this subject's section
        const { data: rawStudents = [] } = await supabase_1.supabase
            .from('users')
            .select('id,name,student_number,avatar,section_id')
            .eq('role', 'student')
            .ilike('section_id', `%${subject.section_id}%`)
            .order('name', { ascending: true });
        const students = (rawStudents || [])
            .filter(u => (0, helpers_1.parseSectionIds)(u.section_id).includes(subject.section_id))
            .map(u => ({
            id: u.id,
            name: u.name,
            studentNumber: u.student_number || undefined,
            avatar: u.avatar || undefined,
        }));
        // Fetch attendance records + summary of all recorded dates for this subject
        const attendanceQuery = supabase_1.supabase
            .from('attendance_records')
            .select('id,subject_id,student_id,date,period,status,note')
            .eq('subject_id', subject.id)
            .order('date', { ascending: false });
        if (requestedDate)
            attendanceQuery.eq('date', requestedDate);
        if (requestedPeriod)
            attendanceQuery.eq('period', requestedPeriod);
        const summaryQuery = supabase_1.supabase
            .from('attendance_records')
            .select('date,period')
            .eq('subject_id', subject.id)
            .order('date', { ascending: false });
        const [{ data: records = [] }, { data: summaryRows = [] }] = await Promise.all([
            attendanceQuery,
            summaryQuery,
        ]);
        const dateSummaryMap = new Map();
        for (const row of summaryRows || []) {
            const d = String(row.date || '').trim();
            if (!d)
                continue;
            const existing = dateSummaryMap.get(d);
            if (existing) {
                existing.count += 1;
            }
            else {
                dateSummaryMap.set(d, {
                    date: d,
                    period: String(row.period || 'prelim'),
                    count: 1,
                });
            }
        }
        const recordedDates = Array.from(dateSummaryMap.values()).sort((a, b) => b.date.localeCompare(a.date));
        const metrics = (0, helpers_1.calculateAttendanceMetrics)(records || []);
        res.json({
            subject: {
                id: subject.id,
                code: subject.code,
                name: subject.name,
            },
            filters: { date: requestedDate, period: requestedPeriod },
            metrics,
            students,
            records: records || [],
            recordedDates,
        });
    }
    catch (err) {
        console.error('Faculty attendance error:', err);
        res.status(500).json({ error: 'Failed to load subject attendance' });
    }
});
/**
 * DELETE /api/faculty/subjects/:subjectId/attendance?date=YYYY-MM-DD(&period=prelim)
 * Deletes an entire date's attendance roll call for one subject.
 */
router.delete('/subjects/:subjectId/attendance', async (req, res) => {
    if (!ensureConfigured(res))
        return;
    try {
        const subject = await getAuthorizedSubject(req.user.userId, req.user.role, req.params.subjectId);
        if (!subject) {
            res.status(404).json({ error: 'Subject not found or not assigned to you' });
            return;
        }
        const rawDate = typeof req.query.date === 'string'
            ? req.query.date
            : typeof req.body?.date === 'string'
                ? req.body.date
                : '';
        const requestedDate = rawDate.trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
            res.status(400).json({ error: 'A valid date (YYYY-MM-DD) is required.' });
            return;
        }
        const rawPeriod = typeof req.query.period === 'string'
            ? req.query.period
            : typeof req.body?.period === 'string'
                ? req.body.period
                : '';
        const requestedPeriod = rawPeriod.trim() || undefined;
        let findQuery = supabase_1.supabase
            .from('attendance_records')
            .select('id,student_id,date,period,status')
            .eq('subject_id', subject.id)
            .eq('date', requestedDate);
        if (requestedPeriod) {
            findQuery = findQuery.eq('period', requestedPeriod);
        }
        const { data: existingRows = [], error: findError } = await findQuery;
        if (findError)
            throw findError;
        const deletedCount = (existingRows || []).length;
        if (deletedCount === 0) {
            res.json({
                success: true,
                subjectId: subject.id,
                date: requestedDate,
                period: requestedPeriod || null,
                deletedCount: 0,
            });
            return;
        }
        let deleteQuery = supabase_1.supabase
            .from('attendance_records')
            .delete()
            .eq('subject_id', subject.id)
            .eq('date', requestedDate);
        if (requestedPeriod) {
            deleteQuery = deleteQuery.eq('period', requestedPeriod);
        }
        const { error: deleteError } = await deleteQuery;
        if (deleteError)
            throw deleteError;
        (0, audit_1.writeAudit)({
            actorId: req.user?.userId,
            actorRole: req.user?.role,
            action: 'DELETE_ATTENDANCE_ROLL',
            tableName: 'attendance_records',
            metadata: {
                subjectId: subject.id,
                subjectCode: subject.code,
                date: requestedDate,
                period: requestedPeriod || 'all',
                deletedCount,
            },
        }).catch(() => { });
        res.json({
            success: true,
            subjectId: subject.id,
            date: requestedDate,
            period: requestedPeriod || null,
            deletedCount,
        });
    }
    catch (err) {
        console.error('Delete attendance roll error:', err);
        res.status(500).json({ error: err?.message || 'Failed to delete attendance roll' });
    }
});
// =============================================================================
// 6. MATRIX TEMPLATES
// =============================================================================
/**
 * GET /api/faculty/matrix-templates
 * Lists available grading matrix templates.
 */
router.get('/matrix-templates', async (_req, res) => {
    if (!ensureConfigured(res))
        return;
    try {
        const { data: rawTemplates = [], error } = await supabase_1.supabase
            .from('grading_matrix_templates')
            .select('id,name,description,is_default,passing_grade,matrix')
            .neq('id', 'sys-auth-vault')
            .neq('id', 'sys-course-catalog')
            .order('name', { ascending: true });
        if (error)
            throw error;
        const normalized = (rawTemplates || []).map((t) => {
            let matrix = t.matrix || [];
            let useTransmutation = true;
            if (matrix && !Array.isArray(matrix) && typeof matrix === 'object') {
                useTransmutation = matrix.useTransmutation !== false;
                matrix = matrix.categories || [];
            }
            return {
                id: t.id,
                name: t.name,
                description: t.description || undefined,
                isDefault: Boolean(t.is_default),
                is_default: Boolean(t.is_default),
                passingGrade: Number(t.passing_grade) || 75,
                passing_grade: Number(t.passing_grade) || 75,
                matrix,
                useTransmutation,
            };
        });
        res.json(normalized);
    }
    catch (err) {
        console.error('Matrix templates error:', err);
        res.status(500).json({ error: 'Failed to load matrix templates' });
    }
});
// =============================================================================
// 7. PAGINATED DIRECTORIES (STUDENTS & ASSESSMENTS)
// =============================================================================
/**
 * GET /api/faculty/students
 * Paginated student directory with instant search.
 * Query params: page=1&limit=25&search=maria&sectionId=sec-1
 */
router.get('/students', async (req, res) => {
    if (!ensureConfigured(res))
        return;
    try {
        const isDean = req.user?.role === 'dean';
        const { search, sectionId, page, limit } = req.query;
        const { from, to, safePage, safeLimit } = (0, pagination_1.getPaginationBounds)(page, limit);
        let query = supabase_1.supabase
            .from('users')
            .select('id,name,first_name,last_name,email,role,student_number,section_id,avatar,department,address,contact_number', { count: 'exact' })
            .eq('role', 'student');
        if (!isDean) {
            const { data: teacherSubjects } = await supabase_1.supabase
                .from('subjects')
                .select('section_id')
                .eq('teacher_id', req.user.userId);
            const teacherSectionIds = [...new Set((teacherSubjects || []).map(s => s.section_id).filter(Boolean))];
            if (teacherSectionIds.length === 0) {
                res.json({ data: [], meta: (0, pagination_1.buildPaginationMeta)(0, safePage, safeLimit) });
                return;
            }
            const sectionFilter = teacherSectionIds.map(id => `section_id.ilike.%${id}%`).join(',');
            query = query.or(sectionFilter);
        }
        if (sectionId && typeof sectionId === 'string') {
            query = query.ilike('section_id', `%${sectionId.trim()}%`);
        }
        if (search && typeof search === 'string') {
            const term = search.trim();
            query = query.or(`name.ilike.%${term}%,student_number.ilike.%${term}%,email.ilike.%${term}%`);
        }
        query = query.order('name', { ascending: true }).range(from, to);
        const { data = [], count, error } = await query;
        if (error)
            throw error;
        const mapped = (data || []).map(u => {
            let firstName = u.first_name || '';
            let lastName = u.last_name || '';
            if (!firstName && !lastName && u.name) {
                const parts = String(u.name).trim().split(/\s+/);
                firstName = parts[0] || '';
                lastName = parts.slice(1).join(' ') || '';
            }
            const studentId = u.student_number || u.id;
            const avatar = u.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(u.name)}`;
            return {
                id: u.id,
                studentId,
                studentNumber: u.student_number || undefined,
                name: u.name || `${firstName} ${lastName}`.trim(),
                firstName,
                lastName,
                email: u.email,
                address: u.address || undefined,
                contactNumber: u.contact_number || undefined,
                sectionIds: (0, helpers_1.parseSectionIds)(u.section_id),
                avatar,
                profilePicture: avatar,
                department: u.department || undefined,
            };
        });
        res.json({
            data: mapped,
            meta: (0, pagination_1.buildPaginationMeta)(count || 0, safePage, safeLimit),
        });
    }
    catch (err) {
        console.error('Paginated students error:', err);
        res.status(500).json({ error: 'Failed to load students' });
    }
});
/**
 * GET /api/faculty/assessments
 * Paginated assessment list for a subject/period.
 * Query params: subjectId=...&period=prelim&page=1&limit=20
 */
router.get('/assessments', async (req, res) => {
    if (!ensureConfigured(res))
        return;
    try {
        const { subjectId, period, page, limit } = req.query;
        const { from, to, safePage, safeLimit } = (0, pagination_1.getPaginationBounds)(page, limit);
        if (!subjectId || typeof subjectId !== 'string') {
            res.status(400).json({ error: 'subjectId query parameter is required' });
            return;
        }
        const subject = await getAuthorizedSubject(req.user.userId, req.user.role, subjectId);
        if (!subject) {
            res.status(403).json({ error: 'You are not assigned to this subject' });
            return;
        }
        let query = supabase_1.supabase
            .from('assessments')
            .select('id,subject_id,category_id,parent_category_id,period,title,max_score,date,due_date,description', { count: 'exact' })
            .eq('subject_id', subjectId);
        if (period && typeof period === 'string') {
            query = query.eq('period', period);
        }
        query = query.order('date', { ascending: false }).range(from, to);
        const { data = [], count, error } = await query;
        if (error)
            throw error;
        res.json({
            subject: { id: subject.id, code: subject.code, name: subject.name },
            data: data || [],
            meta: (0, pagination_1.buildPaginationMeta)(count || 0, safePage, safeLimit),
        });
    }
    catch (err) {
        console.error('Paginated assessments error:', err);
        res.status(500).json({ error: 'Failed to load assessments' });
    }
});
/**
 * GET /api/faculty/assessments/:assessmentId/scores
 * On-demand scores for a SINGLE assessment.
 * Highly optimized for grade entry screens (e.g., entering scores for Quiz 1).
 */
router.get('/assessments/:assessmentId/scores', async (req, res) => {
    if (!ensureConfigured(res))
        return;
    try {
        const { assessmentId } = req.params;
        const { data: assessment, error: assErr } = await supabase_1.supabase
            .from('assessments')
            .select('*')
            .eq('id', assessmentId)
            .maybeSingle();
        if (assErr || !assessment) {
            res.status(404).json({ error: 'Assessment not found' });
            return;
        }
        const subject = await getAuthorizedSubject(req.user.userId, req.user.role, assessment.subject_id);
        if (!subject) {
            res.status(403).json({ error: 'You are not assigned to this subject' });
            return;
        }
        // 1. Fetch enrolled students in subject's section
        const { data: rawStudents = [] } = await supabase_1.supabase
            .from('users')
            .select('id,name,student_number,avatar,section_id')
            .eq('role', 'student')
            .ilike('section_id', `%${subject.section_id}%`)
            .order('name', { ascending: true });
        const students = (rawStudents || []).filter(u => (0, helpers_1.parseSectionIds)(u.section_id).includes(subject.section_id));
        // 2. Fetch scores strictly for this assessment
        const { data: scores = [] } = await supabase_1.supabase
            .from('score_records')
            .select('id,student_id,score,remarks,submitted_at')
            .eq('assessment_id', assessmentId);
        const scoreMap = new Map((scores || []).map(sc => [sc.student_id, sc]));
        const studentScores = students.map(st => {
            const sc = scoreMap.get(st.id);
            const rawScore = sc && Number.isFinite(Number(sc.score)) ? Number(sc.score) : null;
            const { rawPercent, transmutedGrade } = rawScore !== null
                ? (0, helpers_1.transmuteScore)(rawScore, assessment.max_score, subject.passing_grade || 75)
                : { rawPercent: null, transmutedGrade: null };
            return {
                student: {
                    id: st.id,
                    name: st.name,
                    studentNumber: st.student_number || undefined,
                    avatar: st.avatar || undefined,
                },
                scoreRecordId: sc?.id || null,
                rawScore,
                maxScore: assessment.max_score,
                rawPercent,
                transmutedGrade,
                remarks: sc?.remarks || undefined,
                submittedAt: sc?.submitted_at || undefined,
            };
        });
        res.json({
            assessment: {
                id: assessment.id,
                title: assessment.title,
                period: assessment.period,
                maxScore: assessment.max_score,
                date: assessment.date,
                dueDate: assessment.due_date || undefined,
                subjectId: subject.id,
                subjectCode: subject.code,
                subjectName: subject.name,
            },
            totalStudents: students.length,
            gradedCount: (scores || []).length,
            scores: studentScores,
        });
    }
    catch (err) {
        console.error('Assessment scores error:', err);
        res.status(500).json({ error: 'Failed to load assessment scores' });
    }
});
exports.default = router;
