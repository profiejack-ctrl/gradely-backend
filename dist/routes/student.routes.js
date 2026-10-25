"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const supabase_1 = require("../lib/supabase");
const helpers_1 = require("../lib/helpers");
const router = (0, express_1.Router)();
router.use(auth_1.requireStudent);
const PERIODS = ['prelim', 'midterm', 'finals'];
function mapStudent(user) {
    const sectionIds = (0, helpers_1.parseSectionIds)(user.section_id);
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: 'student',
        studentNumber: user.student_number || undefined,
        sectionId: sectionIds[0] || undefined,
        sectionIds,
        avatar: user.avatar || undefined,
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
function mapSubject(subject, teacher) {
    let matrix = subject.matrix || [];
    let useTransmutation = true;
    if (matrix && !Array.isArray(matrix) && typeof matrix === 'object') {
        useTransmutation = matrix.useTransmutation !== false;
        matrix = matrix.categories || [];
    }
    return {
        id: subject.id,
        sectionId: subject.section_id,
        name: subject.name,
        code: subject.code,
        schedule: subject.schedule || undefined,
        units: subject.units ?? 3,
        passingGrade: subject.passing_grade ?? 75,
        matrix,
        useTransmutation,
        teacher: teacher ? { id: teacher.id, name: teacher.name } : undefined,
    };
}
function mapAssessment(assessment, score) {
    return {
        id: assessment.id,
        categoryId: assessment.category_id,
        parentCategoryId: assessment.parent_category_id || undefined,
        period: assessment.period || 'prelim',
        title: assessment.title,
        maxScore: assessment.max_score,
        date: assessment.date,
        dueDate: assessment.due_date || undefined,
        description: assessment.description || undefined,
        score: score
            ? { id: score.id, value: score.score, remarks: score.remarks || undefined, submittedAt: score.submitted_at }
            : null,
    };
}
function mapAttendance(record) {
    return {
        id: record.id,
        date: record.date,
        period: record.period || 'prelim',
        status: record.status,
        note: record.note || undefined,
    };
}
function summarizeProgress(subjectId, assessments, scores, attendance) {
    const scoreByAssessment = new Map(scores.map(score => [score.assessment_id, score]));
    const periods = Object.fromEntries(PERIODS.map(period => {
        const periodAssessments = assessments.filter(a => (a.period || 'prelim') === period);
        const periodAttendance = attendance.filter(a => (a.period || 'prelim') === period);
        const scoredAssessments = periodAssessments.filter(a => scoreByAssessment.has(a.id));
        const earned = scoredAssessments.reduce((sum, assessment) => {
            const score = scoreByAssessment.get(assessment.id)?.score;
            return sum + Math.min(Number(assessment.max_score) || 0, Math.max(0, Number(score) || 0));
        }, 0);
        const possible = periodAssessments.reduce((sum, assessment) => sum + (Number(assessment.max_score) || 0), 0);
        const presentUnits = periodAttendance.reduce((sum, record) => {
            if (record.status === 'late')
                return sum + 0.5;
            if (record.status === 'present' || record.status === 'excused')
                return sum + 1;
            return sum;
        }, 0);
        return [period, {
                period,
                assessmentCount: periodAssessments.length,
                scoredAssessmentCount: scoredAssessments.length,
                scoreCompletionPercent: periodAssessments.length
                    ? Math.round((scoredAssessments.length / periodAssessments.length) * 1000) / 10
                    : 0,
                rawScorePercent: possible ? Math.round((earned / possible) * 1000) / 10 : null,
                attendance: {
                    total: periodAttendance.length,
                    present: periodAttendance.filter(a => a.status === 'present').length,
                    late: periodAttendance.filter(a => a.status === 'late').length,
                    absent: periodAttendance.filter(a => a.status === 'absent').length,
                    excused: periodAttendance.filter(a => a.status === 'excused').length,
                    rate: periodAttendance.length ? Math.round((presentUnits / periodAttendance.length) * 1000) / 10 : null,
                },
                hasRecords: periodAssessments.length > 0 || periodAttendance.length > 0,
            }];
    }));
    return { subjectId, periods };
}
async function loadStudentData(studentId) {
    if (!supabase_1.supabase)
        throw new Error('Database not configured');
    const { data: student, error: studentError } = await supabase_1.supabase
        .from('users')
        .select('id,name,email,role,student_number,section_id,avatar,department,title')
        .eq('id', studentId)
        .eq('role', 'student')
        .single();
    if (studentError)
        throw studentError;
    const sectionIds = (0, helpers_1.parseSectionIds)(student.section_id);
    const [sectionsResult, subjectsResult] = await Promise.all([
        sectionIds.length
            ? supabase_1.supabase.from('sections').select('id,name,grade_level_or_year,academic_year,semester,room').in('id', sectionIds)
            : Promise.resolve({ data: [], error: null }),
        sectionIds.length
            ? supabase_1.supabase.from('subjects').select('id,section_id,teacher_id,name,code,schedule,units,passing_grade,matrix').in('section_id', sectionIds)
            : Promise.resolve({ data: [], error: null }),
    ]);
    if (sectionsResult.error)
        throw sectionsResult.error;
    if (subjectsResult.error)
        throw subjectsResult.error;
    const subjects = subjectsResult.data || [];
    const subjectIds = subjects.map(subject => subject.id);
    const teacherIds = [...new Set(subjects.map(subject => subject.teacher_id).filter(Boolean))];
    const [assessmentsResult, attendanceResult, teachersResult] = await Promise.all([
        subjectIds.length
            ? supabase_1.supabase.from('assessments').select('id,subject_id,category_id,parent_category_id,period,title,max_score,date,due_date,description').in('subject_id', subjectIds).order('date', { ascending: true })
            : Promise.resolve({ data: [], error: null }),
        subjectIds.length
            ? supabase_1.supabase.from('attendance_records').select('id,subject_id,date,period,status,note').eq('student_id', studentId).in('subject_id', subjectIds).order('date', { ascending: false })
            : Promise.resolve({ data: [], error: null }),
        teacherIds.length
            ? supabase_1.supabase.from('users').select('id,name').in('id', teacherIds)
            : Promise.resolve({ data: [], error: null }),
    ]);
    if (assessmentsResult.error)
        throw assessmentsResult.error;
    if (attendanceResult.error)
        throw attendanceResult.error;
    if (teachersResult.error)
        throw teachersResult.error;
    const assessments = assessmentsResult.data || [];
    const assessmentIds = assessments.map(assessment => assessment.id);
    const scoresResult = assessmentIds.length
        ? await supabase_1.supabase.from('score_records').select('id,assessment_id,score,remarks,submitted_at').eq('student_id', studentId).in('assessment_id', assessmentIds)
        : { data: [], error: null };
    if (scoresResult.error)
        throw scoresResult.error;
    const scores = scoresResult.data || [];
    const teachersById = new Map((teachersResult.data || []).map(teacher => [teacher.id, teacher]));
    const assessmentsBySubject = new Map();
    assessments.forEach(assessment => {
        const list = assessmentsBySubject.get(assessment.subject_id) || [];
        list.push(assessment);
        assessmentsBySubject.set(assessment.subject_id, list);
    });
    const attendanceBySubject = new Map();
    (attendanceResult.data || []).forEach(record => {
        const list = attendanceBySubject.get(record.subject_id) || [];
        list.push(record);
        attendanceBySubject.set(record.subject_id, list);
    });
    const scoresByAssessment = new Map(scores.map(score => [score.assessment_id, score]));
    return {
        student: mapStudent(student),
        sections: (sectionsResult.data || []).map(mapSection),
        subjects,
        assessmentsBySubject,
        attendanceBySubject,
        scoresByAssessment,
        scores,
        teachersById,
    };
}
async function loadStudentProfile(studentId) {
    if (!supabase_1.supabase)
        throw new Error('Database not configured');
    const { data: student, error: studentError } = await supabase_1.supabase
        .from('users')
        .select('id,name,email,role,student_number,section_id,avatar,department,title')
        .eq('id', studentId)
        .eq('role', 'student')
        .single();
    if (studentError)
        throw studentError;
    const sectionIds = (0, helpers_1.parseSectionIds)(student.section_id);
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
async function loadSingleSubjectData(studentId, subjectId) {
    if (!supabase_1.supabase)
        throw new Error('Database not configured');
    const profile = await loadStudentProfile(studentId);
    if (profile.sectionIds.length === 0)
        return { ...profile, subject: null };
    const { data: subject, error: subjectError } = await supabase_1.supabase
        .from('subjects')
        .select('id,section_id,teacher_id,name,code,schedule,units,passing_grade,matrix')
        .eq('id', subjectId)
        .in('section_id', profile.sectionIds)
        .maybeSingle();
    if (subjectError)
        throw subjectError;
    if (!subject)
        return { ...profile, subject: null };
    const [assessmentsResult, attendanceResult, teacherResult] = await Promise.all([
        supabase_1.supabase.from('assessments')
            .select('id,subject_id,category_id,parent_category_id,period,title,max_score,date,due_date,description')
            .eq('subject_id', subject.id)
            .order('date', { ascending: true }),
        supabase_1.supabase.from('attendance_records')
            .select('id,subject_id,date,period,status,note')
            .eq('student_id', studentId)
            .eq('subject_id', subject.id)
            .order('date', { ascending: false }),
        subject.teacher_id
            ? supabase_1.supabase.from('users').select('id,name').eq('id', subject.teacher_id).maybeSingle()
            : Promise.resolve({ data: null, error: null }),
    ]);
    if (assessmentsResult.error)
        throw assessmentsResult.error;
    if (attendanceResult.error)
        throw attendanceResult.error;
    if (teacherResult.error)
        throw teacherResult.error;
    const assessments = assessmentsResult.data || [];
    const scoresResult = assessments.length
        ? await supabase_1.supabase.from('score_records')
            .select('id,assessment_id,score,remarks,submitted_at')
            .eq('student_id', studentId)
            .in('assessment_id', assessments.map(assessment => assessment.id))
        : { data: [], error: null };
    if (scoresResult.error)
        throw scoresResult.error;
    const scores = scoresResult.data || [];
    return {
        ...profile,
        subject,
        teacher: teacherResult.data,
        assessments,
        attendance: attendanceResult.data || [],
        scores,
        scoresByAssessment: new Map(scores.map(score => [score.assessment_id, score])),
    };
}
function ensureConfigured(res) {
    if (!supabase_1.isSupabaseConfigured || !supabase_1.supabase) {
        res.status(503).json({ error: 'Database not configured' });
        return false;
    }
    return true;
}
/** GET /api/student/profile */
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
/** GET /api/student/dashboard */
router.get('/dashboard', async (req, res) => {
    if (!ensureConfigured(res))
        return;
    try {
        const data = await loadStudentData(req.user.userId);
        const subjects = data.subjects.map(subject => {
            const assessments = data.assessmentsBySubject.get(subject.id) || [];
            const attendance = data.attendanceBySubject.get(subject.id) || [];
            const scores = assessments.map(assessment => data.scoresByAssessment.get(assessment.id)).filter(Boolean);
            return {
                subject: mapSubject(subject, data.teachersById.get(subject.teacher_id)),
                progress: summarizeProgress(subject.id, assessments, scores, attendance),
            };
        });
        res.json({ version: 1, student: data.student, sections: data.sections, subjects });
    }
    catch (error) {
        console.error('Student dashboard error:', error);
        res.status(500).json({ error: 'Failed to load student dashboard' });
    }
});
/** GET /api/student/subjects */
router.get('/subjects', async (req, res) => {
    if (!ensureConfigured(res))
        return;
    try {
        const profile = await loadStudentProfile(req.user.userId);
        const subjectsResult = profile.sectionIds.length
            ? await supabase_1.supabase.from('subjects')
                .select('id,section_id,teacher_id,name,code,schedule,units,passing_grade,matrix')
                .in('section_id', profile.sectionIds)
                .order('code', { ascending: true })
            : { data: [], error: null };
        if (subjectsResult.error)
            throw subjectsResult.error;
        const teacherIds = [...new Set((subjectsResult.data || []).map(subject => subject.teacher_id).filter(Boolean))];
        const teachersResult = teacherIds.length
            ? await supabase_1.supabase.from('users').select('id,name').in('id', teacherIds)
            : { data: [], error: null };
        if (teachersResult.error)
            throw teachersResult.error;
        const teachersById = new Map((teachersResult.data || []).map(teacher => [teacher.id, teacher]));
        res.json({
            sections: profile.sections,
            subjects: (subjectsResult.data || []).map(subject => mapSubject(subject, teachersById.get(subject.teacher_id))),
        });
    }
    catch (error) {
        console.error('Student subjects error:', error);
        res.status(500).json({ error: 'Failed to load enrolled subjects' });
    }
});
/** GET /api/student/subjects/:subjectId */
router.get('/subjects/:subjectId', async (req, res) => {
    if (!ensureConfigured(res))
        return;
    try {
        const data = await loadSingleSubjectData(req.user.userId, req.params.subjectId);
        if (!data.subject) {
            res.status(404).json({ error: 'Subject not found or not enrolled' });
            return;
        }
        const assessments = data.assessments || [];
        const attendance = data.attendance || [];
        const scores = data.scores || [];
        res.json({
            student: data.student,
            subject: mapSubject(data.subject, data.teacher),
            assessments: assessments.map(assessment => mapAssessment(assessment, data.scoresByAssessment.get(assessment.id))),
            attendance: attendance.map(mapAttendance),
            progress: summarizeProgress(data.subject.id, assessments, scores, attendance),
        });
    }
    catch (error) {
        console.error('Student subject error:', error);
        res.status(500).json({ error: 'Failed to load subject progress' });
    }
});
/** GET /api/student/attendance */
router.get('/attendance', async (req, res) => {
    if (!ensureConfigured(res))
        return;
    try {
        const profile = await loadStudentProfile(req.user.userId);
        const subjectFilter = typeof req.query.subjectId === 'string' ? req.query.subjectId : undefined;
        const subjectQuery = profile.sectionIds.length
            ? supabase_1.supabase.from('subjects').select('id').in('section_id', profile.sectionIds)
            : Promise.resolve({ data: [], error: null });
        const subjectsResult = await subjectQuery;
        if (subjectsResult.error)
            throw subjectsResult.error;
        const subjectIds = (subjectsResult.data || []).map(subject => subject.id)
            .filter(subjectId => !subjectFilter || subjectId === subjectFilter);
        const attendanceResult = subjectIds.length
            ? await supabase_1.supabase.from('attendance_records')
                .select('id,subject_id,date,period,status,note')
                .eq('student_id', req.user.userId)
                .in('subject_id', subjectIds)
                .order('date', { ascending: false })
            : { data: [], error: null };
        if (attendanceResult.error)
            throw attendanceResult.error;
        const attendance = (attendanceResult.data || [])
            .map(record => ({ subjectId: record.subject_id, ...mapAttendance(record) }));
        res.json({ attendance });
    }
    catch (error) {
        console.error('Student attendance error:', error);
        res.status(500).json({ error: 'Failed to load attendance' });
    }
});
exports.default = router;
