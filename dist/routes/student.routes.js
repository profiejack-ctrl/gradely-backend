"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const auth_1 = require("../middleware/auth");
const supabase_1 = require("../lib/supabase");
const calendarEvents_1 = require("../lib/calendarEvents");
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
    const hasStudentAttendance = periodAttendance.length > 0;
    const attPct = hasStudentAttendance ? attendanceMetrics.attendancePercent : null;
    // 1. Resolve Category & Sub-Category Weights extracted from active subject matrix
    const csCat = matrix.find(c => /standing|class/i.test(c.name));
    const projCat = matrix.find(c => /project|cbo|output/i.test(c.name));
    const examCat = matrix.find(c => /exam|we/i.test(c.name));
    const csWeight = csCat?.weight ?? 35;
    const projWeight = projCat?.weight ?? 40;
    const examWeight = examCat?.weight ?? 25;
    const attSub = csCat?.subCategories?.find(s => /attendance/i.test(s.name));
    const wwSub = csCat?.subCategories?.find(s => /written|quiz/i.test(s.name));
    const ptSub = csCat?.subCategories?.find(s => /task|performance|lab/i.test(s.name));
    const attWeight = attSub?.weight ?? 10;
    const wwWeight = wwSub?.weight ?? 40;
    const ptWeight = ptSub?.weight ?? 50;
    // 2. Classify assessments into WW, PT, EXAM, PROJECT
    const getAssessmentType = (a) => {
        const catId = (a.category_id || a.categoryId || '').toLowerCase();
        const parentId = (a.parent_category_id || a.parentCategoryId || '').toLowerCase();
        const title = (a.title || '').toUpperCase();
        const subName = (a.subCategoryName || a.categoryName || '').toUpperCase();
        if (wwSub && (catId === wwSub.id?.toLowerCase() || parentId === wwSub.id?.toLowerCase()))
            return 'WW';
        if (ptSub && (catId === ptSub.id?.toLowerCase() || parentId === ptSub.id?.toLowerCase()))
            return 'PT';
        if (examCat && (catId === examCat.id?.toLowerCase() || parentId === examCat.id?.toLowerCase()))
            return 'EXAM';
        if (projCat && (catId === projCat.id?.toLowerCase() || parentId === projCat.id?.toLowerCase()))
            return 'PROJECT';
        if (subName.includes('QUIZ') || subName.includes('WRITTEN') || title.includes('QUIZ') || title.includes('WRITTEN') || catId.includes('ww')) {
            return 'WW';
        }
        if (subName.includes('EXAM') || title.includes('EXAM') || catId.includes('exam') || catId.includes('we')) {
            return 'EXAM';
        }
        if (subName.includes('PROJECT') || subName.includes('CBO') || title.includes('PROJECT') || title.includes('CBO') || catId.includes('cbo')) {
            return 'PROJECT';
        }
        return 'PT';
    };
    const wwAss = [];
    const ptAss = [];
    const examAss = [];
    const projAss = [];
    periodAssessments.forEach(ass => {
        const type = getAssessmentType(ass);
        if (type === 'WW')
            wwAss.push(ass);
        else if (type === 'PT')
            ptAss.push(ass);
        else if (type === 'EXAM')
            examAss.push(ass);
        else if (type === 'PROJECT')
            projAss.push(ass);
    });
    // Helper for Transmutable Groups (WW, PT, Exam):
    // No attempt -> 50.0 floor; Attempt with 0 -> 65.0; Attempt with score -> transmuted
    const calcTransmutableGroup = (assList) => {
        if (assList.length === 0)
            return { active: false, transmuted: 0, raw: 0 };
        let sumTransmuted = 0;
        let earnedRaw = 0;
        let maxRaw = 0;
        assList.forEach(a => {
            const sc = scoreByAssessment.get(a.id);
            const score = sc && sc.score !== undefined && sc.score !== null ? sc.score : undefined;
            const max = Number(a.max_score) || 100;
            const res = (0, helpers_1.transmuteScore)(score, max, subject.passingGrade || 75);
            sumTransmuted += res.transmutedGrade;
            earnedRaw += res.hasAttempt ? Math.max(0, Number(score)) : 0;
            maxRaw += max;
        });
        const transmuted = Math.round((sumTransmuted / assList.length) * 10) / 10;
        const raw = maxRaw > 0 ? Math.round((earnedRaw / maxRaw) * 1000) / 10 : 0;
        return { active: true, transmuted, raw };
    };
    // Helper for Fixed Groups (Project / CBO):
    const calcFixedGroup = (assList) => {
        if (assList.length === 0)
            return { active: false, transmuted: 0, raw: 0 };
        let earnedRaw = 0;
        let maxRaw = 0;
        assList.forEach(a => {
            const sc = scoreByAssessment.get(a.id);
            const max = Number(a.max_score) || 100;
            if (sc && sc.score !== undefined && sc.score !== null && Number.isFinite(Number(sc.score))) {
                earnedRaw += Math.max(0, Number(sc.score));
            }
            maxRaw += max;
        });
        const raw = maxRaw > 0 ? Math.round((earnedRaw / maxRaw) * 1000) / 10 : 0;
        return { active: true, transmuted: raw, raw };
    };
    const ww = calcTransmutableGroup(wwAss);
    const pt = calcTransmutableGroup(ptAss);
    const exam = calcTransmutableGroup(examAss);
    const proj = calcFixedGroup(projAss);
    // Combine Class Standing sub-components:
    let csActiveWeight = 0;
    let csTransmutedSum = 0;
    let csRawSum = 0;
    if (hasStudentAttendance && attPct !== null) {
        csActiveWeight += attWeight;
        csTransmutedSum += attPct * attWeight;
        csRawSum += attPct * attWeight;
    }
    if (ww.active) {
        csActiveWeight += wwWeight;
        csTransmutedSum += ww.transmuted * wwWeight;
        csRawSum += ww.raw * wwWeight;
    }
    if (pt.active) {
        csActiveWeight += ptWeight;
        csTransmutedSum += pt.transmuted * ptWeight;
        csRawSum += pt.raw * ptWeight;
    }
    const csActive = csActiveWeight > 0;
    const csTransmuted = csActive ? csTransmutedSum / csActiveWeight : 0;
    const csRaw = csActive ? csRawSum / csActiveWeight : 0;
    // Combine Main Categories:
    let totalMainWeight = 0;
    let periodTransmutedSum = 0;
    let periodRawSum = 0;
    if (csActive) {
        totalMainWeight += csWeight;
        periodTransmutedSum += csTransmuted * csWeight;
        periodRawSum += csRaw * csWeight;
    }
    if (proj.active) {
        totalMainWeight += projWeight;
        periodTransmutedSum += proj.transmuted * projWeight;
        periodRawSum += proj.raw * projWeight;
    }
    if (exam.active) {
        totalMainWeight += examWeight;
        periodTransmutedSum += exam.transmuted * examWeight;
        periodRawSum += exam.raw * examWeight;
    }
    // Synthesize live Attendance Assessment into assessments if attendance was recorded
    const allAssessments = [...periodAssessments];
    if (hasStudentAttendance) {
        allAssessments.push({
            id: `att-${subject.id}-${period}`,
            subjectId: subject.id,
            categoryId: attSub?.id || 'sub-proflab-att',
            categoryName: 'Attendance',
            period,
            title: `${period.toUpperCase()} Attendance Record`,
            maxScore: 100,
            date: new Date().toISOString().slice(0, 10),
            isAttendance: true,
            description: `Auto-computed from ${attendanceMetrics.total} attendance session(s)`,
            score: {
                id: `att-score-${subject.id}-${period}`,
                rawScore: attPct ?? 100,
                maxScore: 100,
                rawPercent: attPct ?? 100,
                transmutedGrade: attPct ?? 100,
                submittedAt: new Date().toISOString(),
                remarks: `${attendanceMetrics.present} present, ${attendanceMetrics.late} late, ${attendanceMetrics.absent} absent`,
            },
        });
    }
    // If no assessments exist in this period and no roll call was conducted yet:
    if (totalMainWeight === 0) {
        return {
            period,
            gradeDisplayMode,
            attendance: attendanceMetrics,
            rawGrade: null,
            transmutedGrade: null,
            isPassing: null,
            categories: [],
            assessments: allAssessments.map(a => {
                const sc = a.isAttendance ? a.score : scoreByAssessment.get(a.id);
                return {
                    id: a.id,
                    title: a.title,
                    categoryId: a.category_id || a.categoryId,
                    period: a.period,
                    maxScore: a.max_score,
                    date: a.date,
                    dueDate: a.due_date || a.dueDate,
                    isAttendance: Boolean(a.isAttendance),
                    score: sc ? {
                        id: sc.id,
                        rawScore: sc.score !== undefined ? sc.score : sc.rawScore,
                        maxScore: a.max_score,
                        rawPercent: (0, helpers_1.transmuteScore)(sc.score !== undefined ? sc.score : sc.rawScore, a.max_score, subject.passingGrade || 75).rawPercent,
                        transmutedGrade: (0, helpers_1.transmuteScore)(sc.score !== undefined ? sc.score : sc.rawScore, a.max_score, subject.passingGrade || 75).transmutedGrade,
                        remarks: sc.remarks,
                        submittedAt: sc.submitted_at || sc.submittedAt,
                    } : null,
                };
            }),
        };
    }
    const finalTransmuted = Math.round((periodTransmutedSum / totalMainWeight) * 10) / 10;
    const finalRaw = Math.round((periodRawSum / totalMainWeight) * 10) / 10;
    const categoryBreakdown = [
        {
            categoryId: 'cs',
            name: 'Class Standing',
            weight: csWeight,
            isAttendance: false,
            earned: csRaw,
            possible: 100,
            rawPercent: csActive ? Math.round(csRaw * 10) / 10 : null,
            transmutedGrade: csActive ? Math.round(csTransmuted * 10) / 10 : null,
        },
        {
            categoryId: 'exam',
            name: 'Examination',
            weight: examWeight,
            isAttendance: false,
            earned: exam.raw,
            possible: 100,
            rawPercent: exam.active ? exam.raw : null,
            transmutedGrade: exam.active ? exam.transmuted : null,
        },
        {
            categoryId: 'project',
            name: 'Project (CBO)',
            weight: projWeight,
            isAttendance: false,
            earned: proj.raw,
            possible: 100,
            rawPercent: proj.active ? proj.raw : null,
            transmutedGrade: proj.active ? proj.transmuted : null,
        },
    ];
    return {
        period,
        gradeDisplayMode,
        attendance: attendanceMetrics,
        rawGrade: finalRaw,
        transmutedGrade: finalTransmuted,
        isPassing: finalTransmuted >= (subject.passingGrade || 75),
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
        const calendarEvents = await (0, calendarEvents_1.getCalendarEvents)();
        res.json({
            student: profile.student,
            events: calendarEvents,
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
 * GET /api/student/calendar
 * Returns all upcoming academic events, examinations, holidays, and campus activities
 */
router.get('/calendar', async (_req, res) => {
    try {
        const events = await (0, calendarEvents_1.getCalendarEvents)();
        res.json({ events });
    }
    catch (error) {
        console.error('Student calendar error:', error);
        res.status(500).json({ error: 'Failed to load calendar events' });
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
        const subjectIds = subjects.map(s => s.id);
        const [teachersRes, attendanceRes, assessmentsRes] = await Promise.all([
            teacherIds.length ? supabase_1.supabase.from('users').select('id,name').in('id', teacherIds) : { data: [] },
            subjectIds.length ? supabase_1.supabase.from('attendance_records').select('*').eq('student_id', req.user.userId).in('subject_id', subjectIds) : { data: [] },
            subjectIds.length ? supabase_1.supabase.from('assessments').select('*').in('subject_id', subjectIds) : { data: [] },
        ]);
        const assessments = assessmentsRes.data || [];
        const attendance = attendanceRes.data || [];
        const assessmentIds = assessments.map(a => a.id);
        const { data: scoresData } = assessmentIds.length
            ? await supabase_1.supabase.from('score_records').select('*').eq('student_id', req.user.userId).in('assessment_id', assessmentIds)
            : { data: [] };
        const scoreMap = new Map((scoresData || []).map(sc => [sc.assessment_id, sc]));
        const teachersById = new Map((teachersRes.data || []).map(t => [t.id, t]));
        const mappedSubjects = subjects.map(s => {
            const teacher = teachersById.get(s.teacher_id);
            const mapped = mapSubject(s, teacher);
            const subAssessments = assessments.filter(a => a.subject_id === s.id);
            const subAttendance = attendance.filter(a => a.subject_id === s.id);
            let currentGrade = null;
            let activePeriodName = 'prelim';
            for (const p of PERIODS) {
                const pAss = subAssessments.filter(a => (a.period || 'prelim') === p);
                const pAtt = subAttendance.filter(a => (a.period || 'prelim') === p);
                if (pAss.length > 0 || pAtt.length > 0) {
                    const prog = calculateSubjectPeriodProgress(s, p, pAss, pAtt, scoreMap, mapped.matrix, mapped.gradeDisplayMode);
                    if (prog.transmutedGrade !== null) {
                        currentGrade = prog.transmutedGrade;
                        activePeriodName = p;
                    }
                }
            }
            let scoredCount = 0;
            for (const a of subAssessments) {
                if (scoreMap.has(a.id))
                    scoredCount++;
            }
            const totalCount = subAssessments.length;
            const completion = totalCount > 0 ? (scoredCount / totalCount) * 100 : 0;
            return {
                ...mapped,
                rawScorePercent: currentGrade,
                grade: currentGrade,
                transmutedGrade: currentGrade,
                period: activePeriodName,
                assessmentCount: totalCount,
                scoredAssessmentCount: scoredCount,
                scoreCompletionPercent: Math.round(completion * 10) / 10,
            };
        });
        res.json({
            sections: profile.sections,
            subjects: mappedSubjects,
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
        // Find the latest active period with recorded grades
        const activePeriodProgress = periodsProgress['finals']?.transmutedGrade !== null
            ? periodsProgress['finals']
            : periodsProgress['midterm']?.transmutedGrade !== null
                ? periodsProgress['midterm']
                : periodsProgress['prelim'];
        const resolvedGrade = activePeriodProgress?.transmutedGrade ?? null;
        const scoredCount = scoresData?.length || 0;
        const totalCount = assessments.length;
        const completion = totalCount > 0 ? (scoredCount / totalCount) * 100 : 0;
        const progressSummary = {
            rawScorePercent: resolvedGrade,
            grade: resolvedGrade,
            transmutedGrade: resolvedGrade,
            period: activePeriodProgress?.period || 'prelim',
            assessmentCount: totalCount,
            scoredAssessmentCount: scoredCount,
            scoreCompletionPercent: Math.round(completion * 10) / 10,
            periods: periodsProgress,
        };
        res.json({
            student: profile.student,
            subject: {
                ...mappedSubject,
                rawScorePercent: resolvedGrade,
                grade: resolvedGrade,
                transmutedGrade: resolvedGrade,
                period: activePeriodProgress?.period || 'prelim',
                assessmentCount: totalCount,
                scoredAssessmentCount: scoredCount,
                scoreCompletionPercent: Math.round(completion * 10) / 10,
            },
            progress: progressSummary,
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
