"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const supabase_1 = require("../lib/supabase");
const authVault_1 = require("../lib/authVault");
const helpers_1 = require("../lib/helpers");
const audit_1 = require("../lib/audit");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
// Map of table to ON CONFLICT column(s)
const ON_CONFLICT_MAP = {
    attendance_records: 'subject_id,student_id,date',
    score_records: 'assessment_id,student_id',
    users: 'id',
    sections: 'id',
    subjects: 'id',
    assessments: 'id',
    grading_matrix_templates: 'id',
    holidays: 'id',
};
const ALLOWED_TABLES = new Set(Object.keys(ON_CONFLICT_MAP));
async function teacherOwnsSubject(userId, subjectId, context) {
    if (context?.subjects?.has(subjectId)) {
        return context.subjects.get(subjectId)?.teacher_id === userId;
    }
    if (!supabase_1.supabase)
        return false;
    const { data } = await supabase_1.supabase.from('subjects').select('teacher_id').eq('id', subjectId).maybeSingle();
    return data?.teacher_id === userId;
}
async function teacherOwnsSection(userId, sectionId, context) {
    if (context?.sections?.has(sectionId)) {
        const sec = context.sections.get(sectionId);
        if (sec?.description?.startsWith(`[adviser:${userId}]`))
            return true;
    }
    if (!supabase_1.supabase || !sectionId)
        return false;
    const { data: section } = await supabase_1.supabase
        .from('sections')
        .select('description')
        .eq('id', sectionId)
        .maybeSingle();
    if (section?.description?.startsWith(`[adviser:${userId}]`))
        return true;
    const { data: subject } = await supabase_1.supabase
        .from('subjects')
        .select('id')
        .eq('section_id', sectionId)
        .eq('teacher_id', userId)
        .limit(1)
        .maybeSingle();
    return Boolean(subject);
}
async function studentBelongsToSubject(subjectId, studentId, context) {
    let subject = context?.subjects?.get(subjectId);
    let student = context?.users?.get(studentId);
    if (!subject) {
        if (!supabase_1.supabase)
            return false;
        const { data } = await supabase_1.supabase.from('subjects').select('section_id').eq('id', subjectId).maybeSingle();
        subject = data;
    }
    if (!student) {
        if (!supabase_1.supabase)
            return false;
        const { data } = await supabase_1.supabase.from('users').select('role,section_id').eq('id', studentId).maybeSingle();
        student = data;
    }
    if (!subject || student?.role !== 'student')
        return false;
    return (0, helpers_1.parseSectionIds)(student.section_id).includes(subject.section_id);
}
function isValidEmail(value) {
    return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function isValidDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
function sectionIdsFromPayload(payload) {
    if (Array.isArray(payload?.sectionIds))
        return payload.sectionIds.filter((id) => typeof id === 'string');
    return (0, helpers_1.parseSectionIds)(payload?.section_id || payload?.sectionId);
}
function validatePayload(table, action, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        return 'Invalid mutation payload';
    if (action === 'DELETE')
        return typeof payload.id === 'string' && payload.id.length > 0 ? null : 'A record id is required';
    if (typeof payload.id !== 'string' || payload.id.length < 1 || payload.id.length > 160)
        return 'Invalid record id';
    if (table === 'users') {
        if (typeof payload.name !== 'string' || payload.name.trim().length < 2 || payload.name.length > 160)
            return 'Invalid user name';
        if (!isValidEmail(payload.email))
            return 'Invalid user email';
        if (!['dean', 'teacher', 'student'].includes(payload.role))
            return 'Invalid user role';
    }
    if (table === 'sections') {
        if (!payload.name || !payload.grade_level_or_year || !payload.academic_year || !payload.semester)
            return 'Incomplete section data';
    }
    if (table === 'subjects') {
        if (!payload.name || !payload.code || typeof payload.section_id !== 'string' || typeof payload.teacher_id !== 'string')
            return 'Incomplete subject data';
        if (payload.passing_grade !== undefined && (!Number.isFinite(Number(payload.passing_grade)) || Number(payload.passing_grade) < 0 || Number(payload.passing_grade) > 100))
            return 'Invalid passing grade';
    }
    if (table === 'assessments') {
        if (!payload.subject_id || !payload.title || !isValidDate(payload.date))
            return 'Incomplete assessment data';
        if (!Number.isFinite(Number(payload.max_score)) || Number(payload.max_score) <= 0 || Number(payload.max_score) > 100000)
            return 'Assessment max score must be greater than zero';
        if (!['prelim', 'midterm', 'finals'].includes(payload.period || 'prelim'))
            return 'Invalid grading period';
    }
    if (table === 'score_records') {
        if (!payload.assessment_id || !payload.student_id || !Number.isFinite(Number(payload.score)) || Number(payload.score) < 0)
            return 'Invalid score data';
    }
    if (table === 'attendance_records') {
        if (!payload.subject_id || !payload.student_id || !isValidDate(payload.date))
            return 'Incomplete attendance data';
        if (!['present', 'late', 'absent', 'excused'].includes(payload.status))
            return 'Invalid attendance status';
    }
    return null;
}
async function canMutate(req, table, action, payload, context) {
    if (validatePayload(table, action, payload))
        return false;
    if (req.user?.role === 'dean') {
        if (payload?.id === 'sys-auth-vault')
            return false;
        if (table === 'score_records' && action === 'UPSERT') {
            const assessment = context?.assessments?.get(payload.assessment_id) ||
                (await supabase_1.supabase.from('assessments').select('max_score').eq('id', payload.assessment_id).maybeSingle()).data;
            return Boolean(assessment && Number(payload.score) <= Number(assessment.max_score));
        }
        return true;
    }
    if (req.user?.role === 'student') {
        if (table === 'users' && action === 'UPSERT') {
            return payload.id === req.user.userId && (!payload.role || payload.role === 'student');
        }
        return false;
    }
    if (req.user?.role !== 'teacher')
        return false;
    // Faculty may edit only records belonging to their own sections/subjects.
    if (table === 'users') {
        if (action === 'UPSERT') {
            if (payload.role !== 'student')
                return false;
            if (payload.id) {
                const { data: existing } = await supabase_1.supabase.from('users').select('role').eq('id', payload.id).maybeSingle();
                if (existing && existing.role !== 'student')
                    return false;
            }
            const ids = sectionIdsFromPayload(payload);
            return ids.length > 0 && (await Promise.all(ids.map(id => teacherOwnsSection(req.user.userId, id, context)))).every(Boolean);
        }
        const { data: existing } = await supabase_1.supabase.from('users').select('role,section_id').eq('id', payload.id).maybeSingle();
        if (!existing || existing.role !== 'student')
            return false;
        const ids = (0, helpers_1.parseSectionIds)(existing.section_id);
        return ids.length > 0 && (await Promise.all(ids.map(id => teacherOwnsSection(req.user.userId, id, context)))).every(Boolean);
    }
    if (table === 'subjects') {
        if (action === 'UPSERT')
            return payload.teacher_id === req.user.userId && await teacherOwnsSection(req.user.userId, payload.section_id, context);
        const { data } = await supabase_1.supabase.from('subjects').select('teacher_id').eq('id', payload.id).maybeSingle();
        return data?.teacher_id === req.user.userId;
    }
    if (table === 'assessments') {
        const subjectId = action === 'DELETE'
            ? (await supabase_1.supabase.from('assessments').select('subject_id').eq('id', payload.id).maybeSingle()).data?.subject_id
            : payload.subject_id;
        return Boolean(subjectId && await teacherOwnsSubject(req.user.userId, subjectId, context));
    }
    if (table === 'score_records') {
        const assessmentId = action === 'DELETE'
            ? (await supabase_1.supabase.from('score_records').select('assessment_id').eq('id', payload.id).maybeSingle()).data?.assessment_id
            : payload.assessment_id;
        const assessment = context?.assessments?.get(assessmentId) ||
            (await supabase_1.supabase.from('assessments').select('subject_id,max_score').eq('id', assessmentId).maybeSingle()).data;
        if (!assessment || !(await teacherOwnsSubject(req.user.userId, assessment.subject_id, context)))
            return false;
        if (action === 'UPSERT' && Number(payload.score) > Number(assessment.max_score))
            return false;
        return action === 'DELETE' || await studentBelongsToSubject(assessment.subject_id, payload.student_id, context);
    }
    if (table === 'attendance_records') {
        const record = action === 'DELETE'
            ? (await supabase_1.supabase.from('attendance_records').select('subject_id,student_id').eq('id', payload.id).maybeSingle()).data
            : { subject_id: payload.subject_id, student_id: payload.student_id };
        const subjectId = record?.subject_id;
        if (!subjectId || !(await teacherOwnsSubject(req.user.userId, subjectId, context)))
            return false;
        return action === 'DELETE' || await studentBelongsToSubject(subjectId, record.student_id, context);
    }
    if (table === 'sections') {
        if (action === 'UPSERT') {
            if (payload.adviserId && payload.adviserId === req.user.userId)
                return true;
            if (payload.description?.startsWith(`[adviser:${req.user.userId}]`))
                return true;
            if (!payload.adviserId && (!payload.description || !payload.description.includes('[adviser:')))
                return true;
        }
        const { data: section } = await supabase_1.supabase.from('sections').select('description').eq('id', payload.id).maybeSingle();
        return Boolean(section?.description?.startsWith(`[adviser:${req.user.userId}]`));
    }
    return false;
}
function normalizePayload(table, payload, reqUser) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        return null;
    const copy = { ...payload };
    // Never allow client-controlled database metadata or credential fields.
    delete copy.created_at;
    delete copy.updated_at;
    delete copy.password;
    delete copy.passwordHash;
    delete copy.password_hash;
    delete copy.customPassword;
    delete copy.custom_password;
    delete copy.mustChangePassword;
    delete copy.adviserId;
    delete copy.sectionIds;
    if (table === 'users') {
        if (payload.sectionIds !== undefined)
            copy.section_id = (0, helpers_1.formatSectionIds)(payload.sectionIds);
        if (reqUser?.role === 'student') {
            delete copy.role;
            delete copy.section_id;
            delete copy.student_number;
        }
    }
    const fieldsByTable = {
        users: ['id', 'name', 'email', 'role', 'student_number', 'section_id', 'avatar', 'department', 'title'],
        sections: ['id', 'name', 'grade_level_or_year', 'academic_year', 'semester', 'room', 'description'],
        subjects: ['id', 'section_id', 'teacher_id', 'name', 'code', 'schedule', 'units', 'passing_grade', 'matrix'],
        assessments: ['id', 'subject_id', 'category_id', 'parent_category_id', 'period', 'title', 'max_score', 'date', 'due_date', 'description'],
        score_records: ['id', 'assessment_id', 'student_id', 'score', 'remarks', 'submitted_at'],
        attendance_records: ['id', 'subject_id', 'student_id', 'date', 'period', 'status', 'note'],
        grading_matrix_templates: ['id', 'name', 'description', 'is_default', 'passing_grade', 'matrix'],
        holidays: ['id', 'date', 'title', 'type', 'description'],
    };
    const allowed = new Set(fieldsByTable[table] || []);
    Object.keys(copy).forEach((key) => {
        if (!allowed.has(key))
            delete copy[key];
    });
    return copy;
}
// GET /api/data/all
router.get('/all', async (req, res) => {
    if (!supabase_1.isSupabaseConfigured || !supabase_1.supabase) {
        res.status(503).json({ error: 'Database not configured' });
        return;
    }
    try {
        const [usersRes, sectionsRes, templatesRes, subjectsRes, assessmentsRes, scoresRes, attendanceRes, holidaysRes,] = await Promise.all([
            supabase_1.supabase.from('users').select('*'),
            supabase_1.supabase.from('sections').select('*'),
            supabase_1.supabase.from('grading_matrix_templates').select('*'),
            supabase_1.supabase.from('subjects').select('*'),
            supabase_1.supabase.from('assessments').select('*'),
            supabase_1.supabase.from('score_records').select('*'),
            supabase_1.supabase.from('attendance_records').select('*'),
            supabase_1.supabase.from('holidays').select('*'),
        ]);
        let visibleUsers = usersRes.data || [];
        let visibleSections = sectionsRes.data || [];
        let visibleSubjects = subjectsRes.data || [];
        let visibleAssessments = assessmentsRes.data || [];
        let visibleScores = scoresRes.data || [];
        let visibleAttendance = attendanceRes.data || [];
        if (req.user?.role === 'teacher') {
            const teacherSectionIds = new Set(visibleSections
                .filter((s) => s.description?.startsWith(`[adviser:${req.user.userId}]`))
                .map((s) => s.id));
            visibleSubjects = visibleSubjects.filter((s) => s.teacher_id === req.user.userId);
            visibleSubjects.forEach((s) => teacherSectionIds.add(s.section_id));
            visibleSections = visibleSections.filter((s) => teacherSectionIds.has(s.id));
            visibleUsers = visibleUsers.filter((u) => u.id === req.user.userId || (0, helpers_1.parseSectionIds)(u.section_id).some(id => teacherSectionIds.has(id)));
            const subjectIds = new Set(visibleSubjects.map((s) => s.id));
            visibleAssessments = visibleAssessments.filter((a) => subjectIds.has(a.subject_id));
            const assessmentIds = new Set(visibleAssessments.map((a) => a.id));
            visibleScores = visibleScores.filter((s) => assessmentIds.has(s.assessment_id));
            visibleAttendance = visibleAttendance.filter((a) => subjectIds.has(a.subject_id));
        }
        else if (req.user?.role === 'student') {
            const currentStudent = visibleUsers.find((u) => u.id === req.user.userId);
            const studentSectionIds = new Set((0, helpers_1.parseSectionIds)(currentStudent?.section_id));
            visibleUsers = visibleUsers.filter((u) => u.id === req.user.userId);
            visibleSections = visibleSections.filter((s) => studentSectionIds.has(s.id));
            visibleSubjects = visibleSubjects.filter((s) => studentSectionIds.has(s.section_id));
            const subjectIds = new Set(visibleSubjects.map((s) => s.id));
            visibleAssessments = visibleAssessments.filter((a) => subjectIds.has(a.subject_id));
            const assessmentIds = new Set(visibleAssessments.map((a) => a.id));
            visibleScores = visibleScores.filter((s) => s.student_id === req.user.userId && assessmentIds.has(s.assessment_id));
            visibleAttendance = visibleAttendance.filter((a) => a.student_id === req.user.userId && subjectIds.has(a.subject_id));
        }
        const users = visibleUsers.map((u) => {
            const sectionIds = (0, helpers_1.parseSectionIds)(u.section_id);
            return {
                id: u.id, name: u.name, email: u.email, role: u.role,
                studentNumber: u.student_number || undefined,
                sectionId: sectionIds[0] || undefined, sectionIds,
                avatar: u.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(u.name)}`,
                department: u.department || undefined, title: u.title || undefined,
            };
        });
        const sections = visibleSections.map((s) => {
            const { description, adviserId } = (0, helpers_1.decodeSectionDescription)(s.description);
            return {
                id: s.id, name: s.name, gradeLevelOrYear: s.grade_level_or_year,
                academicYear: s.academic_year, semester: s.semester,
                room: s.room || undefined, description, adviserId,
            };
        });
        const matrixTemplates = (templatesRes.data || [])
            .filter((t) => t.id !== 'sys-auth-vault')
            .map((t) => {
            let matrix = t.matrix || [];
            let useTransmutation = true;
            if (matrix && !Array.isArray(matrix) && typeof matrix === 'object') {
                useTransmutation = matrix.useTransmutation !== false;
                matrix = matrix.categories || [];
            }
            return {
                id: t.id, name: t.name, description: t.description || undefined,
                isDefault: t.is_default ?? false, passingGrade: t.passing_grade ?? 75,
                matrix,
                useTransmutation,
            };
        });
        const subjects = visibleSubjects.map((sub) => {
            let matrix = sub.matrix || [];
            let useTransmutation = true;
            if (matrix && !Array.isArray(matrix) && typeof matrix === 'object') {
                useTransmutation = matrix.useTransmutation !== false;
                matrix = matrix.categories || [];
            }
            return {
                id: sub.id, sectionId: sub.section_id, teacherId: sub.teacher_id,
                name: sub.name, code: sub.code, schedule: sub.schedule,
                units: sub.units, passingGrade: sub.passing_grade ?? 75,
                matrix,
                useTransmutation,
            };
        });
        const assessments = visibleAssessments.map((a) => ({
            id: a.id, subjectId: a.subject_id, categoryId: a.category_id,
            parentCategoryId: a.parent_category_id || undefined,
            period: a.period || 'prelim', title: a.title, maxScore: a.max_score,
            date: a.date, dueDate: a.due_date || undefined, description: a.description || undefined,
        }));
        const scores = visibleScores.map((s) => ({
            id: s.id, assessmentId: s.assessment_id, studentId: s.student_id,
            score: s.score, remarks: s.remarks || undefined, submittedAt: s.submitted_at,
        }));
        const attendance = visibleAttendance.map((a) => ({
            id: a.id, subjectId: a.subject_id, studentId: a.student_id,
            date: a.date, period: a.period, status: a.status, note: a.note || undefined,
        }));
        const holidays = (holidaysRes.data || []).map((h) => ({
            id: h.id, date: h.date, title: h.title, type: h.type,
            description: h.description || undefined,
        }));
        res.json({ users, sections, subjects, assessments, scores, attendance, matrixTemplates, holidays });
    }
    catch (err) {
        console.error('Failed to load all data:', err);
        res.status(500).json({ error: 'Failed to load data' });
    }
});
// POST /api/data/sync — process batch mutations
router.post('/sync', async (req, res) => {
    if (!supabase_1.isSupabaseConfigured || !supabase_1.supabase) {
        res.status(503).json({ error: 'Database not configured' });
        return;
    }
    const { mutations } = req.body;
    if (!Array.isArray(mutations) || mutations.length === 0) {
        res.json({ success: true, synced: 0 });
        return;
    }
    if (mutations.length > 500) {
        res.status(413).json({ error: 'Mutation batch is too large' });
        return;
    }
    if (mutations.some(m => !m || !ALLOWED_TABLES.has(m.table) || !['UPSERT', 'DELETE'].includes(m.action))) {
        res.status(400).json({ error: 'Invalid mutation table or action' });
        return;
    }
    const errors = [];
    let synced = 0;
    // Process mutations in batches by table+action
    const groups = new Map();
    for (const m of mutations) {
        const key = `${m.table}::${m.action}`;
        if (!groups.has(key))
            groups.set(key, []);
        groups.get(key).push(m);
    }
    for (const [key, group] of groups) {
        const [table, action] = key.split('::');
        try {
            const context = {
                subjects: new Map(),
                sections: new Map(),
                users: new Map(),
                assessments: new Map(),
            };
            // Pre-fetch lookups for the batch to avoid N+1 query storms
            if (table === 'attendance_records') {
                const subIds = [...new Set(group.map(m => m.payload?.subject_id).filter(Boolean))];
                const studIds = [...new Set(group.map(m => m.payload?.student_id).filter(Boolean))];
                const [subsRes, studsRes] = await Promise.all([
                    subIds.length > 0 ? supabase_1.supabase.from('subjects').select('id, teacher_id, section_id').in('id', subIds) : { data: [] },
                    studIds.length > 0 ? supabase_1.supabase.from('users').select('id, role, section_id').in('id', studIds) : { data: [] },
                ]);
                (subsRes.data || []).forEach((s) => context.subjects.set(s.id, s));
                (studsRes.data || []).forEach((u) => context.users.set(u.id, u));
            }
            else if (table === 'score_records') {
                const assIds = [...new Set(group.map(m => m.payload?.assessment_id).filter(Boolean))];
                const studIds = [...new Set(group.map(m => m.payload?.student_id).filter(Boolean))];
                const [assRes, studsRes] = await Promise.all([
                    assIds.length > 0 ? supabase_1.supabase.from('assessments').select('id, subject_id, max_score').in('id', assIds) : { data: [] },
                    studIds.length > 0 ? supabase_1.supabase.from('users').select('id, role, section_id').in('id', studIds) : { data: [] },
                ]);
                (assRes.data || []).forEach((a) => context.assessments.set(a.id, a));
                (studsRes.data || []).forEach((u) => context.users.set(u.id, u));
                const subIds = [...new Set((assRes.data || []).map((a) => a.subject_id).filter(Boolean))];
                if (subIds.length > 0) {
                    const { data: subsData } = await supabase_1.supabase.from('subjects').select('id, teacher_id, section_id').in('id', subIds);
                    (subsData || []).forEach((s) => context.subjects.set(s.id, s));
                }
            }
            // Pre-fetch beforeRows for audit in a single batch query
            const recordIds = group.map(m => m.payload?.id).filter(Boolean);
            const beforeRows = new Map();
            if (recordIds.length > 0) {
                const { data: befores } = await supabase_1.supabase.from(table).select('*').in('id', recordIds);
                (befores || []).forEach((b) => beforeRows.set(b.id, b));
            }
            if (action === 'UPSERT') {
                const payloads = [];
                for (const m of group) {
                    const validationError = validatePayload(table, action, m.payload);
                    if (validationError) {
                        res.status(400).json({ error: validationError });
                        return;
                    }
                    if (!await canMutate(req, table, action, m.payload, context)) {
                        res.status(403).json({ error: `Not authorized to modify ${table}` });
                        return;
                    }
                    const normalized = normalizePayload(table, m.payload, req.user);
                    if (!normalized) {
                        res.status(400).json({ error: `Invalid payload for ${table}` });
                        return;
                    }
                    if (table === 'sections' && m.payload.description !== undefined) {
                        normalized.description = (0, helpers_1.encodeSectionDescription)(m.payload.description, m.payload.adviserId);
                    }
                    if (req.user?.role === 'student' && table === 'users') {
                        const existing = beforeRows.get(m.payload.id);
                        normalized.role = 'student';
                        if (existing) {
                            normalized.section_id = existing.section_id;
                            normalized.student_number = existing.student_number;
                        }
                    }
                    payloads.push(normalized);
                }
                const onConflict = ON_CONFLICT_MAP[table] || 'id';
                const { error } = await supabase_1.supabase.from(table).upsert(payloads, { onConflict });
                if (error)
                    errors.push(`${table} UPSERT: ${error.message}`);
                else {
                    synced += group.length;
                    const auditEntries = group.map(m => ({
                        actor_id: req.user?.userId || null,
                        actor_role: req.user?.role || null,
                        action: 'UPSERT',
                        table_name: table,
                        record_id: m.payload.id || null,
                        before_data: beforeRows.get(m.payload.id) || null,
                        after_data: normalizePayload(table, m.payload, req.user),
                    }));
                    (0, audit_1.writeAudit)({
                        actorId: req.user?.userId,
                        actorRole: req.user?.role,
                        action: 'UPSERT_BATCH',
                        tableName: table,
                        metadata: { count: group.length, sample: auditEntries[0] },
                    }).catch(() => { });
                }
            }
            else if (action === 'DELETE') {
                for (const m of group) {
                    const validationError = validatePayload(table, action, m.payload);
                    if (validationError) {
                        res.status(400).json({ error: validationError });
                        return;
                    }
                    if (!await canMutate(req, table, action, m.payload, context)) {
                        res.status(403).json({ error: `Not authorized to delete from ${table}` });
                        return;
                    }
                }
                const ids = group.map(m => m.payload.id).filter(Boolean);
                if (ids.length > 0) {
                    const { error } = await supabase_1.supabase.from(table).delete().in('id', ids);
                    if (error)
                        errors.push(`${table} DELETE: ${error.message}`);
                    else {
                        if (table === 'users')
                            await (0, authVault_1.pruneVaultToActiveUsers)();
                        synced += ids.length;
                        (0, audit_1.writeAudit)({
                            actorId: req.user?.userId,
                            actorRole: req.user?.role,
                            action: 'DELETE_BATCH',
                            tableName: table,
                            metadata: { count: ids.length, ids },
                        }).catch(() => { });
                    }
                }
            }
        }
        catch (err) {
            errors.push(`${table}: ${err.message}`);
        }
    }
    if (errors.length > 0) {
        res.status(422).json({ success: false, synced, errors });
        return;
    }
    res.json({ success: true, synced, errors: [] });
});
// POST /api/data/push-all — Faculty
router.post('/push-all', auth_1.requireFaculty, async (req, res) => {
    if (!supabase_1.isSupabaseConfigured || !supabase_1.supabase) {
        res.status(503).json({ error: 'Database not configured' });
        return;
    }
    const { users, sections, subjects, assessments, scores, attendance, matrixTemplates, holidays } = req.body;
    const errors = [];
    try {
        if (Array.isArray(users) && users.length > 0) {
            const dbUsers = users.map((u) => ({
                id: u.id,
                name: u.name,
                email: u.email,
                role: u.role,
                avatar: u.avatar || null,
                student_number: u.studentNumber || null,
                section_id: u.sectionIds ? (0, helpers_1.formatSectionIds)(u.sectionIds) : (u.sectionId || null),
                department: u.department || null,
                title: u.title || null,
            }));
            const { error } = await supabase_1.supabase.from('users').upsert(dbUsers, { onConflict: 'id' });
            if (error)
                errors.push(`users: ${error.message}`);
        }
        if (Array.isArray(sections) && sections.length > 0) {
            const dbSections = sections.map((s) => ({
                id: s.id,
                name: s.name,
                grade_level_or_year: s.gradeLevelOrYear,
                academic_year: s.academicYear,
                semester: s.semester,
                room: s.room || null,
                description: (0, helpers_1.encodeSectionDescription)(s.description, s.adviserId),
            }));
            const { error } = await supabase_1.supabase.from('sections').upsert(dbSections, { onConflict: 'id' });
            if (error)
                errors.push(`sections: ${error.message}`);
        }
        if (Array.isArray(matrixTemplates) && matrixTemplates.length > 0) {
            const dbTemplates = matrixTemplates
                .filter((t) => t.id !== 'sys-auth-vault')
                .map((t) => ({
                id: t.id,
                name: t.name,
                description: t.description || null,
                is_default: t.isDefault ?? false,
                passing_grade: t.passingGrade ?? 75,
                matrix: {
                    categories: Array.isArray(t.matrix) ? t.matrix : (t.matrix?.categories || []),
                    useTransmutation: t.useTransmutation !== false,
                },
            }));
            if (dbTemplates.length > 0) {
                const { error } = await supabase_1.supabase.from('grading_matrix_templates').upsert(dbTemplates, { onConflict: 'id' });
                if (error)
                    errors.push(`matrixTemplates: ${error.message}`);
            }
        }
        if (Array.isArray(subjects) && subjects.length > 0) {
            const dbSubjects = subjects.map((sub) => ({
                id: sub.id,
                section_id: sub.sectionId,
                teacher_id: sub.teacherId,
                name: sub.name,
                code: sub.code,
                schedule: sub.schedule || null,
                units: sub.units || null,
                passing_grade: sub.passingGrade ?? 75,
                matrix: {
                    categories: Array.isArray(sub.matrix) ? sub.matrix : (sub.matrix?.categories || []),
                    useTransmutation: sub.useTransmutation !== false,
                },
            }));
            const { error } = await supabase_1.supabase.from('subjects').upsert(dbSubjects, { onConflict: 'id' });
            if (error)
                errors.push(`subjects: ${error.message}`);
        }
        if (Array.isArray(assessments) && assessments.length > 0) {
            const dbAssessments = assessments.map((a) => ({
                id: a.id,
                subject_id: a.subjectId,
                category_id: a.categoryId,
                parent_category_id: a.parentCategoryId || null,
                period: a.period || 'prelim',
                title: a.title,
                max_score: a.maxScore,
                date: a.date,
                due_date: a.dueDate || null,
                description: a.description || null,
            }));
            const { error } = await supabase_1.supabase.from('assessments').upsert(dbAssessments, { onConflict: 'id' });
            if (error)
                errors.push(`assessments: ${error.message}`);
        }
        if (Array.isArray(scores) && scores.length > 0) {
            const dbScores = scores.map((sc) => ({
                id: sc.id,
                assessment_id: sc.assessmentId,
                student_id: sc.studentId,
                score: sc.score,
                remarks: sc.remarks || null,
                submitted_at: sc.submittedAt || new Date().toISOString(),
            }));
            const { error } = await supabase_1.supabase.from('score_records').upsert(dbScores, { onConflict: 'assessment_id,student_id' });
            if (error)
                errors.push(`scores: ${error.message}`);
        }
        if (Array.isArray(attendance) && attendance.length > 0) {
            const dbAttendance = attendance.map((at) => ({
                id: at.id,
                subject_id: at.subjectId,
                student_id: at.studentId,
                date: at.date,
                period: at.period || null,
                status: at.status,
                note: at.note || null,
            }));
            const { error } = await supabase_1.supabase.from('attendance_records').upsert(dbAttendance, { onConflict: 'subject_id,student_id,date' });
            if (error)
                errors.push(`attendance: ${error.message}`);
        }
        if (Array.isArray(holidays) && holidays.length > 0) {
            const dbHolidays = holidays.map((h) => ({
                id: h.id,
                date: h.date,
                title: h.title,
                type: h.type,
                description: h.description || null,
            }));
            const { error } = await supabase_1.supabase.from('holidays').upsert(dbHolidays, { onConflict: 'id' });
            if (error)
                errors.push(`holidays: ${error.message}`);
        }
        res.json({ success: errors.length === 0, errors });
    }
    catch (err) {
        console.error('push-all error:', err);
        res.status(500).json({ error: err.message || 'Failed to push snapshot' });
    }
});
// DELETE /api/data/wipe — Faculty (Dean or Teacher)
router.delete('/wipe', auth_1.requireFaculty, async (req, res) => {
    if (!supabase_1.isSupabaseConfigured || !supabase_1.supabase) {
        res.status(503).json({ error: 'DB not configured' });
        return;
    }
    const { keepTeachersAndTemplates } = req.query;
    // Wiping faculty accounts completely requires Dean role
    if (keepTeachersAndTemplates !== 'true' && req.user?.role !== 'dean') {
        res.status(403).json({ error: 'Dean access required to wipe faculty accounts' });
        return;
    }
    try {
        const r1 = await supabase_1.supabase.from('score_records').delete().not('id', 'is', null);
        if (r1.error)
            throw new Error(`score_records: ${r1.error.message}`);
        const r2 = await supabase_1.supabase.from('attendance_records').delete().not('id', 'is', null);
        if (r2.error)
            throw new Error(`attendance_records: ${r2.error.message}`);
        const r3 = await supabase_1.supabase.from('assessments').delete().not('id', 'is', null);
        if (r3.error)
            throw new Error(`assessments: ${r3.error.message}`);
        const r4 = await supabase_1.supabase.from('subjects').delete().not('id', 'is', null);
        if (r4.error)
            throw new Error(`subjects: ${r4.error.message}`);
        const r5 = await supabase_1.supabase.from('sections').delete().not('id', 'is', null);
        if (r5.error)
            throw new Error(`sections: ${r5.error.message}`);
        if (keepTeachersAndTemplates === 'true') {
            const r6 = await supabase_1.supabase.from('users').delete().eq('role', 'student');
            if (r6.error)
                throw new Error(`users: ${r6.error.message}`);
        }
        else {
            const r6 = await supabase_1.supabase.from('users').delete().not('id', 'is', null);
            if (r6.error)
                throw new Error(`users: ${r6.error.message}`);
            const r7 = await supabase_1.supabase.from('grading_matrix_templates').delete().neq('id', 'sys-auth-vault');
            if (r7.error)
                throw new Error(`matrix_templates: ${r7.error.message}`);
            const r8 = await supabase_1.supabase.from('holidays').delete().not('id', 'is', null);
            if (r8.error)
                throw new Error(`holidays: ${r8.error.message}`);
        }
        await (0, authVault_1.pruneVaultToActiveUsers)();
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
