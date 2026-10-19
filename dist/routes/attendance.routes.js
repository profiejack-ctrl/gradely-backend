"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const supabase_1 = require("../lib/supabase");
const helpers_1 = require("../lib/helpers");
const router = (0, express_1.Router)();
router.use(auth_1.requireFaculty);
const ATTENDANCE_STATUSES = new Set(['present', 'late', 'absent', 'excused']);
const PERIODS = new Set(['prelim', 'midterm', 'finals']);
function isDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
function todayUtc() {
    return new Date().toISOString().slice(0, 10);
}
/** POST /api/attendance/tap */
router.post('/tap', async (req, res) => {
    if (!supabase_1.isSupabaseConfigured || !supabase_1.supabase) {
        res.status(503).json({ error: 'Database not configured' });
        return;
    }
    const studentNumber = String(req.body?.studentNumber || req.body?.student_number || '').trim();
    const subjectId = String(req.body?.subjectId || req.body?.subject_id || '').trim();
    const date = req.body?.date || todayUtc();
    const status = req.body?.status || 'present';
    const period = req.body?.period || 'prelim';
    const note = req.body?.note || 'ID card tap-in';
    if (!studentNumber || !subjectId) {
        res.status(400).json({ error: 'studentNumber and subjectId are required' });
        return;
    }
    if (!isDate(date)) {
        res.status(400).json({ error: 'date must use YYYY-MM-DD format' });
        return;
    }
    if (!ATTENDANCE_STATUSES.has(status)) {
        res.status(400).json({ error: 'status must be present, late, absent, or excused' });
        return;
    }
    if (!PERIODS.has(period)) {
        res.status(400).json({ error: 'period must be prelim, midterm, or finals' });
        return;
    }
    try {
        const { data: subject, error: subjectError } = await supabase_1.supabase
            .from('subjects')
            .select('id,name,code,teacher_id,section_id')
            .eq('id', subjectId)
            .maybeSingle();
        if (subjectError)
            throw subjectError;
        if (!subject) {
            res.status(404).json({ error: 'Subject not found' });
            return;
        }
        if (req.user?.role === 'teacher' && subject.teacher_id !== req.user.userId) {
            res.status(403).json({ error: 'You are not assigned to this subject' });
            return;
        }
        const { data: student, error: studentError } = await supabase_1.supabase
            .from('users')
            .select('id,name,email,role,student_number,section_id,avatar')
            .eq('student_number', studentNumber)
            .eq('role', 'student')
            .maybeSingle();
        if (studentError)
            throw studentError;
        if (!student) {
            res.status(404).json({ error: 'Student number was not found' });
            return;
        }
        if (!(0, helpers_1.parseSectionIds)(student.section_id).includes(subject.section_id)) {
            res.status(409).json({ error: 'Student is not enrolled in the subject section' });
            return;
        }
        const { data: existing, error: existingError } = await supabase_1.supabase
            .from('attendance_records')
            .select('id')
            .eq('subject_id', subjectId)
            .eq('student_id', student.id)
            .eq('date', date)
            .maybeSingle();
        if (existingError)
            throw existingError;
        const record = {
            id: existing?.id || `att-tap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            subject_id: subjectId,
            student_id: student.id,
            date,
            period,
            status,
            note,
        };
        const { data: saved, error: saveError } = await supabase_1.supabase
            .from('attendance_records')
            .upsert(record, { onConflict: 'subject_id,student_id,date' })
            .select('id,subject_id,student_id,date,period,status,note')
            .single();
        if (saveError)
            throw saveError;
        res.status(existing ? 200 : 201).json({
            success: true,
            created: !existing,
            student: {
                id: student.id,
                name: student.name,
                studentNumber: student.student_number,
            },
            attendance: {
                id: saved.id,
                subjectId: saved.subject_id,
                studentId: saved.student_id,
                date: saved.date,
                period: saved.period,
                status: saved.status,
                note: saved.note || undefined,
            },
        });
    }
    catch (error) {
        console.error('Attendance tap error:', error);
        res.status(500).json({ error: error?.message || 'Failed to record attendance' });
    }
});
exports.default = router;
