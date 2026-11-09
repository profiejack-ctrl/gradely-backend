"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const auth_1 = require("../middleware/auth");
const supabase_1 = require("../lib/supabase");
const authVault_1 = require("../lib/authVault");
const helpers_1 = require("../lib/helpers");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth, auth_1.requireStudent);
const PERIODS = ['prelim', 'midterm', 'finals'];
function mapStudent(user) {
    const sectionIds = (0, helpers_1.parseSectionIds)(user.section_id);
    let firstName = user.first_name || '';
    let lastName = user.last_name || '';
    if (!firstName && !lastName && user.name) {
        const parts = String(user.name).trim().split(/\s+/);
        firstName = parts[0] || '';
        lastName = parts.slice(1).join(' ') || '';
    }
    const studentId = user.student_number || user.id;
    const avatar = user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(user.name || 'student')}`;
    return {
        id: user.id,
        studentId,
        studentNumber: studentId,
        name: user.name || `${firstName} ${lastName}`.trim(),
        firstName,
        lastName,
        email: user.email,
        address: user.address || undefined,
        contactNumber: user.contact_number || undefined,
        avatar,
        profilePicture: avatar,
        role: 'student',
        sectionId: sectionIds[0] || undefined,
        sectionIds,
        department: user.department || undefined,
        title: user.title || undefined,
    };
}
function mapSection(section) {
    return {
        id: section.id,
        name: section.name,
        gradeLevelOrYear: section.grade_level_or_year,
        academicYear: section.academic_year,
        semester: section.semester,
        room: section.room || undefined,
    };
}
/**
 * Resolves grading matrix from template inheritance or custom subject override.
 */
function resolveSubjectMatrix(subject, template) {
    // 1. Custom matrix override on the subject itself
    if (subject.custom_matrix && Array.isArray(subject.custom_matrix) && subject.custom_matrix.length > 0) {
        return { matrix: subject.custom_matrix, templateName: 'Custom Course Syllabus' };
    }
    // 2. Referenced grading matrix template
    if (template) {
        let matrix = template.matrix || [];
        if (matrix && !Array.isArray(matrix) && typeof matrix === 'object') {
            matrix = matrix.categories || [];
        }
        return { matrix, templateName: template.name, templateId: template.id };
    }
    // 3. Fallback to direct matrix column if already populated
    if (subject.matrix) {
        let matrix = subject.matrix;
        if (!Array.isArray(matrix) && typeof matrix === 'object') {
            matrix = matrix.categories || [];
        }
        if (Array.isArray(matrix) && matrix.length > 0) {
            return { matrix, templateName: 'Direct Subject Matrix' };
        }
    }
    // 4. Standard academic default matrix with integrated Attendance category
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
function mapSubject(subject, teacher, template) {
    const { matrix, templateName, templateId } = resolveSubjectMatrix(subject, template);
    const gradeDisplayMode = subject.grade_display_mode || template?.grade_display_mode || 'both';
    const schedule = (0, helpers_1.parseSchedule)(subject.schedule);
    return {
        id: subject.id,
        sectionId: subject.section_id,
        name: subject.name,
        code: subject.code,
        units: subject.units ?? 3,
        passingGrade: subject.passing_grade ?? 75,
        gradeDisplayMode,
        gradingMatrixTemplateId: subject.grading_matrix_template_id || templateId || undefined,
        templateName,
        schedule,
        matrix,
        instructor: teacher?.name || 'Faculty Instructor',
        teacherName: teacher?.name || 'Faculty Instructor',
        teacher: teacher ? { id: teacher.id, name: teacher.name } : undefined,
    };
}
/**
 * Synthesizes an Attendance assessment record for the period and computes
 * weighted category grades including raw and transmuted values.
 */
function calculateSubjectPeriodProgress(subject, period, periodAssessments, periodAttendance, scoreByAssessment, matrix, gradeDisplayMode) {
    const attendanceMetrics = (0, helpers_1.calculateAttendanceMetrics)(periodAttendance);
    const attCategory = matrix.find(c => c.isAttendance || c.id === 'attendance' || /attendance/i.test(c.name)) || {
        id: 'attendance',
        name: 'Attendance',
        weight: 10,
        isAttendance: true,
    };
    // 1. Synthesize live Attendance Assessment into the period's assessments
    const syntheticAttendanceAssessment = {
        id: `att-${subject.id}-${period}`,
        subjectId: subject.id,
        categoryId: attCategory.id,
        categoryName: attCategory.name,
        period,
        title: `${period.toUpperCase()} Attendance Record`,
        maxScore: 100,
        date: new Date().toISOString().slice(0, 10),
        isAttendance: true,
        description: `Auto-computed from ${attendanceMetrics.total} attendance session(s)`,
        score: {
            id: `att-score-${subject.id}-${period}`,
            rawScore: attendanceMetrics.attendancePercent,
            maxScore: 100,
            rawPercent: attendanceMetrics.attendancePercent,
            transmutedGrade: attendanceMetrics.attendancePercent, // Attendance is Fixed
            submittedAt: new Date().toISOString(),
            remarks: `${attendanceMetrics.present} present, ${attendanceMetrics.late} late, ${attendanceMetrics.absent} absent`,
        },
    };
    const allAssessments = [...periodAssessments, syntheticAttendanceAssessment];
    // 2. Calculate category-level weighted averages
    let totalWeight = 0;
    let totalWeightedScore = 0;
    let totalTransmutedWeightedScore = 0;
    const categoryBreakdown = matrix.map(category => {
        const isAtt = category.isAttendance || category.id === attCategory.id;
        const catLower = (category.name || '').toLowerCase();
        const isFixed = isAtt || catLower.includes('project') || catLower.includes('cbo') || catLower.includes('output');
        let earned = 0;
        let possible = 0;
        if (isAtt) {
            earned = attendanceMetrics.attendancePercent;
            possible = 100;
        }
        else {
            const catAssessments = periodAssessments.filter(a => a.category_id === category.id);
            for (const a of catAssessments) {
                const sc = scoreByAssessment.get(a.id);
                if (sc && Number.isFinite(Number(sc.score))) {
                    earned += Math.max(0, Number(sc.score));
                    possible += Math.max(0, Number(a.max_score) || 0);
                }
            }
        }
        const categoryPercent = possible > 0 ? Math.round((earned / possible) * 1000) / 10 : null;
        const categoryTransmuted = categoryPercent !== null
            ? (isFixed
                ? categoryPercent
                : (0, helpers_1.transmuteScore)(categoryPercent, 100, subject.passingGrade || 75).transmutedGrade)
            : null;
        if (categoryPercent !== null) {
            totalWeight += category.weight;
            totalWeightedScore += (categoryPercent * category.weight) / 100;
            totalTransmutedWeightedScore += ((categoryTransmuted ?? categoryPercent) * category.weight) / 100;
        }
        return {
            categoryId: category.id,
            name: category.name,
            weight: category.weight,
            isAttendance: Boolean(isAtt),
            earned,
            possible,
            rawPercent: categoryPercent,
            transmutedGrade: categoryTransmuted,
        };
    });
    const periodRawPercent = totalWeight > 0 ? Math.round((totalWeightedScore / (totalWeight / 100)) * 10) / 10 : null;
    // Only transmute once: already transmuted at component level
    const periodTransmuted = totalWeight > 0 ? Math.round((totalTransmutedWeightedScore / (totalWeight / 100)) * 10) / 10 : null;
    return {
        period,
        gradeDisplayMode,
        attendance: attendanceMetrics,
        rawGrade: periodRawPercent,
        transmutedGrade: periodTransmuted,
        isPassing: periodTransmuted !== null ? periodTransmuted >= (subject.passingGrade || 75) : null,
        categories: categoryBreakdown,
        assessments: allAssessments.map(a => {
            const sc = a.isAttendance ? a.score : scoreByAssessment.get(a.id);
            const scoreObj = sc
                ? {
                    id: sc.id,
                    rawScore: sc.score !== undefined ? sc.score : sc.rawScore,
                    maxScore: a.max_score,
                    rawPercent: (0, helpers_1.transmuteScore)(sc.score !== undefined ? sc.score : sc.rawScore, a.max_score, subject.passingGrade || 75).rawPercent,
                    transmutedGrade: (0, helpers_1.transmuteScore)(sc.score !== undefined ? sc.score : sc.rawScore, a.max_score, subject.passingGrade || 75).transmutedGrade,
                    remarks: sc.remarks || undefined,
                    submittedAt: sc.submitted_at || sc.submittedAt,
                }
                : null;
            return {
                id: a.id,
                title: a.title,
                categoryId: a.category_id || a.categoryId,
                period: a.period,
                maxScore: a.max_score,
                date: a.date,
                dueDate: a.due_date || a.dueDate,
                isAttendance: Boolean(a.isAttendance),
                score: scoreObj,
            };
        }),
    };
}
async function loadStudentProfile(studentId) {
    if (!supabase_1.supabase)
        throw new Error('Database not configured');
    const { data: student, error: studentError } = await supabase_1.supabase
        .from('users')
        .select('*')
        .eq('id', studentId)
        .eq('role', 'student')
        .single();
    if (studentError)
        throw studentError;
    const rawSectionIds = (0, helpers_1.parseSectionIds)(student.section_id);
    const sectionIds = [...new Set(rawSectionIds)].filter(Boolean);
    const sectionsResult = sectionIds.length
        ? await supabase_1.supabase.from('sections').select('id,name,grade_level_or_year,academic_year,semester,room').in('id', sectionIds)
        : { data: [], error: null };
    if (sectionsResult.error)
        throw sectionsResult.error;
    return {
        student: mapStudent(student),
        sectionIds,
        sections: (sectionsResult.data || []).map(mapSection),
    };
}
function ensureConfigured(res) {
    if (!supabase_1.isSupabaseConfigured || !supabase_1.supabase) {
        res.status(503).json({ error: 'Database not configured' });
        return false;
    }
    return true;
}
/**
 * GET /api/student/profile
 * Returns the authenticated student's profile & section enrollments
 */
router.get('/profile', async (req, res) => {
    if (!ensureConfigured(res))
        return;
    try {
        const data = await loadStudentProfile(req.user.userId);
        res.json({ student: data.student, sections: data.sections });
    }
    catch (error) {
        console.error('Student profile error:', error);
        res.status(500).json({ error: 'Failed to load student profile' });
    }
});
/**
 * PUT /api/student/profile
 * Allows the authenticated student to customize their profile on the mobile app:
 * - firstName / first_name
 * - lastName / last_name
 * - address
 * - contactNumber / contact_number / phone
 * - email
 * - avatar / profilePicture
 * - newPassword (optional, minimum 8 characters)
 */
router.put('/profile', async (req, res) => {
    if (!ensureConfigured(res) || !req.user)
        return;
    const { firstName, first_name, lastName, last_name, name, email, address, contactNumber, contact_number, phone, avatar, profilePicture, profile_picture, newPassword, } = req.body;
    try {
        const cleanFirstName = (firstName ?? first_name) !== undefined ? String(firstName ?? first_name).trim() : undefined;
        const cleanLastName = (lastName ?? last_name) !== undefined ? String(lastName ?? last_name).trim() : undefined;
        const cleanAddress = address !== undefined ? String(address).trim() : undefined;
        const cleanContactNumber = (contactNumber ?? contact_number ?? phone) !== undefined
            ? String(contactNumber ?? contact_number ?? phone).trim()
            : undefined;
        const cleanAvatar = (avatar ?? profilePicture ?? profile_picture) !== undefined
            ? String(avatar ?? profilePicture ?? profile_picture).trim()
            : undefined;
        const rawEmail = email !== undefined ? String(email).trim().toLowerCase() : undefined;
        const updates = {};
        // Build unified name if firstName or lastName or name is provided
        if (cleanFirstName !== undefined || cleanLastName !== undefined) {
            const fn = cleanFirstName !== undefined ? cleanFirstName : '';
            const ln = cleanLastName !== undefined ? cleanLastName : '';
            const combined = `${fn} ${ln}`.trim();
            if (combined)
                updates.name = combined;
        }
        else if (name && typeof name === 'string' && name.trim().length >= 2) {
            updates.name = name.trim();
        }
        if (cleanAvatar !== undefined && cleanAvatar.length > 0) {
            updates.avatar = cleanAvatar;
        }
        if (cleanAddress !== undefined) {
            updates.address = cleanAddress;
        }
        if (cleanContactNumber !== undefined) {
            updates.contact_number = cleanContactNumber;
        }
        // Email update and validation
        if (rawEmail !== undefined && rawEmail.length > 0) {
            if (!rawEmail.includes('@') || !rawEmail.includes('.')) {
                res.status(400).json({ error: 'Please enter a valid email address' });
                return;
            }
            // Check for collision with another account
            const { data: existingUser } = await supabase_1.supabase
                .from('users')
                .select('id')
                .ilike('email', rawEmail)
                .neq('id', req.user.userId)
                .maybeSingle();
            if (existingUser) {
                res.status(400).json({ error: 'This email address is already in use by another account' });
                return;
            }
            updates.email = rawEmail;
        }
        if (newPassword) {
            if (typeof newPassword !== 'string' || newPassword.length < 8) {
                res.status(400).json({ error: 'Password must be at least 8 characters' });
                return;
            }
            const vault = await (0, authVault_1.getVault)();
            const hash = await bcryptjs_1.default.hash(newPassword, 10);
            const idx = vault.findIndex(v => v.userId === req.user.userId);
            const vaultEmail = updates.email || req.user.email;
            if (idx >= 0) {
                vault[idx].passwordHash = hash;
                vault[idx].mustChange = false;
                if (updates.email)
                    vault[idx].email = updates.email;
            }
            else {
                vault.push({ userId: req.user.userId, email: vaultEmail, passwordHash: hash, mustChange: false });
            }
            await (0, authVault_1.saveVault)(vault);
        }
        else if (updates.email) {
            const vault = await (0, authVault_1.getVault)();
            const idx = vault.findIndex(v => v.userId === req.user.userId);
            if (idx >= 0) {
                vault[idx].email = updates.email;
                await (0, authVault_1.saveVault)(vault);
            }
        }
        // Best-effort sync to Supabase Auth if user exists there
        try {
            const authUpdates = {};
            if (updates.email)
                authUpdates.email = updates.email;
            if (newPassword)
                authUpdates.password = newPassword;
            if (updates.name)
                authUpdates.user_metadata = { name: updates.name };
            if (Object.keys(authUpdates).length > 0) {
                await supabase_1.supabase.auth.admin.updateUserById(req.user.userId, authUpdates);
            }
        }
        catch (_) { }
        if (Object.keys(updates).length > 0) {
            updates.updated_at = new Date().toISOString();
            const { error: updateError } = await supabase_1.supabase
                .from('users')
                .update(updates)
                .eq('id', req.user.userId);
            if (updateError) {
                res.status(400).json({ error: updateError.message });
                return;
            }
        }
        const updatedProfile = await loadStudentProfile(req.user.userId);
        res.json({
            success: true,
            message: 'Profile updated successfully',
            student: updatedProfile.student,
            sections: updatedProfile.sections,
        });
    }
    catch (error) {
        console.error('Error updating student profile:', error);
        res.status(500).json({ error: 'Failed to update student profile' });
    }
});
/**
 * GET /api/student/dashboard
 * Mobile BFF Summary Dashboard: Lightweight KPIs, today's schedule, overview counters.
 */
router.get('/dashboard', async (req, res) => {
    if (!ensureConfigured(res))
        return;
    try {
        const studentId = req.user.userId;
        const profile = await loadStudentProfile(studentId);
        if (profile.sectionIds.length === 0) {
            res.json({
                student: profile.student,
                overview: { enrolledSubjectsCount: 0, totalUnits: 0, overallAttendanceRate: 100 },
                todaySchedule: [],
                recentAssessments: [],
                subjects: [],
            });
            return;
        }
        // 1. Fetch subjects, templates, and teachers
        const { data: subjectsData, error: subErr } = await supabase_1.supabase
            .from('subjects')
            .select('id,section_id,teacher_id,name,code,schedule,units,passing_grade,matrix')
            .in('section_id', profile.sectionIds);
        if (subErr)
            throw subErr;
        // Deduplicate subjects by ID so students never receive duplicate offerings
        const uniqueSubjectsMap = new Map();
        for (const s of (subjectsData || [])) {
            if (!uniqueSubjectsMap.has(s.id)) {
                uniqueSubjectsMap.set(s.id, s);
            }
        }
        const subjects = Array.from(uniqueSubjectsMap.values());
        const subjectIds = subjects.map(s => s.id);
        const teacherIds = [...new Set(subjects.map(s => s.teacher_id).filter(Boolean))];
        // 2. Fetch parallel auxiliary data
        const [teachersRes, attendanceRes, assessmentsRes] = await Promise.all([
            teacherIds.length ? supabase_1.supabase.from('users').select('id,name').in('id', teacherIds) : { data: [] },
            subjectIds.length ? supabase_1.supabase.from('attendance_records').select('id,subject_id,date,status,period').eq('student_id', studentId).in('subject_id', subjectIds) : { data: [] },
            subjectIds.length ? supabase_1.supabase.from('assessments').select('id,subject_id,title,max_score,date,due_date,period').in('subject_id', subjectIds).order('date', { ascending: false }).limit(6) : { data: [] },
        ]);
        const teachersById = new Map((teachersRes.data || []).map(t => [t.id, t]));
        const allAttendance = attendanceRes.data || [];
        const recentAssessmentsRaw = assessmentsRes.data || [];
        // Fetch scores for the recent assessments to show completion status
        const recentAssessmentIds = recentAssessmentsRaw.map(a => a.id);
        const { data: recentScores } = recentAssessmentIds.length
            ? await supabase_1.supabase.from('score_records').select('id,assessment_id,score').eq('student_id', studentId).in('assessment_id', recentAssessmentIds)
            : { data: [] };
        const scoreMap = new Map((recentScores || []).map(s => [s.assessment_id, s]));
        // 3. Compute KPI overview
        const totalUnits = subjects.reduce((sum, s) => sum + (Number(s.units) || 3), 0);
        const overallAttMetrics = (0, helpers_1.calculateAttendanceMetrics)(allAttendance);
        const currentDay = (0, helpers_1.getDayOfWeek)();
        // 4. Resolve today's schedule from structured sessions
        const todaySchedule = [];
        const subjectsSummary = subjects.map(s => {
            const teacher = teachersById.get(s.teacher_id);
            const mapped = mapSubject(s, teacher);
            const subjectAttendance = allAttendance.filter(a => a.subject_id === s.id);
            const subAttMetrics = (0, helpers_1.calculateAttendanceMetrics)(subjectAttendance);
            // Extract today's sessions
            mapped.schedule.forEach(session => {
                if (session.day === currentDay) {
                    todaySchedule.push({
                        subjectId: s.id,
                        code: s.code,
                        name: s.name,
                        mode: session.mode,
                        startTime: session.startTime,
                        endTime: session.endTime,
                        room: session.room,
                        meetingUrl: session.meetingUrl,
                    });
                }
            });
            return {
                id: s.id,
                code: s.code,
                name: s.name,
                units: mapped.units,
                teacher: mapped.teacher,
                schedule: mapped.schedule,
                attendanceRate: subAttMetrics.attendancePercent,
            };
        });
        // Sort today's classes chronologically
        todaySchedule.sort((a, b) => a.startTime.localeCompare(b.startTime));
        const recentAssessments = recentAssessmentsRaw.map(a => {
            const scoreRecord = scoreMap.get(a.id);
            const subjectObj = subjects.find(s => s.id === a.subject_id);
            const isGraded = Boolean(scoreRecord && scoreRecord.score !== null);
            return {
                id: a.id,
                subjectId: a.subject_id,
                subjectCode: subjectObj?.code || '',
                title: a.title,
                date: a.date,
                dueDate: a.due_date || undefined,
                period: a.period,
                maxScore: a.max_score,
                isGraded,
                score: isGraded ? scoreRecord?.score : null,
            };
        });
        res.json({
            student: profile.student,
            overview: {
                enrolledSubjectsCount: subjects.length,
                totalUnits,
                overallAttendanceRate: overallAttMetrics.attendancePercent,
                currentDay,
            },
            todaySchedule,
            recentAssessments,
            subjects: subjectsSummary,
        });
    }
    catch (error) {
        console.error('Student dashboard error:', error);
        res.status(500).json({ error: 'Failed to load student dashboard' });
    }
});
/**
 * GET /api/student/subjects
 * Lists all enrolled subjects with structured schedule, units, and teacher metadata.
 */
router.get('/subjects', async (req, res) => {
    if (!ensureConfigured(res))
        return;
    try {
        const profile = await loadStudentProfile(req.user.userId);
        if (profile.sectionIds.length === 0) {
            res.json({ sections: profile.sections, subjects: [] });
            return;
        }
        const { data: subjectsData, error: subErr } = await supabase_1.supabase
            .from('subjects')
            .select('id,section_id,teacher_id,name,code,schedule,units,passing_grade,matrix')
            .in('section_id', profile.sectionIds)
            .order('code', { ascending: true });
        if (subErr)
            throw subErr;
        // Deduplicate subjects by ID so students never receive duplicate offerings
        const uniqueSubjectsMap = new Map();
        for (const s of (subjectsData || [])) {
            if (!uniqueSubjectsMap.has(s.id)) {
                uniqueSubjectsMap.set(s.id, s);
            }
        }
        const subjects = Array.from(uniqueSubjectsMap.values());
        const teacherIds = [...new Set(subjects.map(s => s.teacher_id).filter(Boolean))];
        const [teachersRes] = await Promise.all([
            teacherIds.length ? supabase_1.supabase.from('users').select('id,name').in('id', teacherIds) : { data: [] },
        ]);
        const teachersById = new Map((teachersRes.data || []).map(t => [t.id, t]));
        res.json({
            sections: profile.sections,
            subjects: subjects.map(s => mapSubject(s, teachersById.get(s.teacher_id))),
        });
    }
    catch (error) {
        console.error('Student subjects error:', error);
        res.status(500).json({ error: 'Failed to load enrolled subjects' });
    }
});
/**
 * GET /api/student/subjects/:subjectId
 * Detailed subject view: Syllabus breakdown, assessments with raw & transmuted scores,
 * synthetic attendance grade component, and full period calculations.
 */
router.get('/subjects/:subjectId', async (req, res) => {
    if (!ensureConfigured(res))
        return;
    try {
        const studentId = req.user.userId;
        const profile = await loadStudentProfile(studentId);
        if (profile.sectionIds.length === 0) {
            res.status(404).json({ error: 'Subject not found or not enrolled' });
            return;
        }
        const { data: subject, error: subErr } = await supabase_1.supabase
            .from('subjects')
            .select('id,section_id,teacher_id,name,code,schedule,units,passing_grade,matrix')
            .eq('id', req.params.subjectId)
            .in('section_id', profile.sectionIds)
            .maybeSingle();
        if (subErr)
            throw subErr;
        if (!subject) {
            res.status(404).json({ error: 'Subject not found or not enrolled' });
            return;
        }
        // Parallel fetch: teacher, assessments, scores, and attendance
        const [teacherRes, assessmentsRes, attendanceRes] = await Promise.all([
            subject.teacher_id ? supabase_1.supabase.from('users').select('id,name').eq('id', subject.teacher_id).maybeSingle() : { data: null },
            supabase_1.supabase.from('assessments').select('*').eq('subject_id', subject.id).order('date', { ascending: true }),
            supabase_1.supabase.from('attendance_records').select('*').eq('student_id', studentId).eq('subject_id', subject.id).order('date', { ascending: false }),
        ]);
        const assessments = assessmentsRes.data || [];
        const attendance = attendanceRes.data || [];
        const assessmentIds = assessments.map(a => a.id);
        const { data: scoresData } = assessmentIds.length
            ? await supabase_1.supabase.from('score_records').select('*').eq('student_id', studentId).in('assessment_id', assessmentIds)
            : { data: [] };
        const scoreByAssessment = new Map((scoresData || []).map(sc => [sc.assessment_id, sc]));
        const mappedSubject = mapSubject(subject, teacherRes.data);
        // Compute progress and period breakdowns with integrated attendance
        const periodsProgress = Object.fromEntries(PERIODS.map(period => {
            const periodAssessments = assessments.filter(a => (a.period || 'prelim') === period);
            const periodAttendance = attendance.filter(a => (a.period || 'prelim') === period);
            return [
                period,
                calculateSubjectPeriodProgress(subject, period, periodAssessments, periodAttendance, scoreByAssessment, mappedSubject.matrix, mappedSubject.gradeDisplayMode),
            ];
        }));
        res.json({
            student: profile.student,
            subject: mappedSubject,
            periods: periodsProgress,
            rawAttendanceRecords: attendance.map(a => ({
                id: a.id,
                date: a.date,
                period: a.period || 'prelim',
                status: a.status,
                note: a.note || undefined,
            })),
        });
    }
    catch (error) {
        console.error('Student subject detail error:', error);
        res.status(500).json({ error: 'Failed to load subject details' });
    }
});
/**
 * GET /api/student/attendance
 * Returns all attendance records for the student, optionally filtered by ?subjectId=...
 */
router.get('/attendance', async (req, res) => {
    if (!ensureConfigured(res))
        return;
    try {
        const studentId = req.user.userId;
        const profile = await loadStudentProfile(studentId);
        const subjectFilter = typeof req.query.subjectId === 'string' ? req.query.subjectId : undefined;
        const { data: subjectsData } = profile.sectionIds.length
            ? await supabase_1.supabase.from('subjects').select('id,code,name').in('section_id', profile.sectionIds)
            : { data: [] };
        const subjectMap = new Map((subjectsData || []).map(s => [s.id, s]));
        const subjectIds = Array.from(subjectMap.keys()).filter(id => !subjectFilter || id === subjectFilter);
        const { data: attendanceData, error } = subjectIds.length
            ? await supabase_1.supabase
                .from('attendance_records')
                .select('id,subject_id,date,period,status,note')
                .eq('student_id', studentId)
                .in('subject_id', subjectIds)
                .order('date', { ascending: false })
            : { data: [], error: null };
        if (error)
            throw error;
        const attendance = (attendanceData || []).map(record => ({
            id: record.id,
            subjectId: record.subject_id,
            subjectCode: subjectMap.get(record.subject_id)?.code || '',
            subjectName: subjectMap.get(record.subject_id)?.name || '',
            date: record.date,
            period: record.period || 'prelim',
            status: record.status,
            note: record.note || undefined,
        }));
        const metrics = (0, helpers_1.calculateAttendanceMetrics)(attendance);
        res.json({
            summary: metrics,
            attendance,
        });
    }
    catch (error) {
        console.error('Student attendance error:', error);
        res.status(500).json({ error: 'Failed to load attendance records' });
    }
});
exports.default = router;
