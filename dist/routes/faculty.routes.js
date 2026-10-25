"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const supabase_1 = require("../lib/supabase");
const helpers_1 = require("../lib/helpers");
const router = (0, express_1.Router)();
router.use(auth_1.requireFaculty);
async function fetchAllRows(table, columns, configure, pageSize = 1000) {
    if (!supabase_1.supabase)
        return [];
    const rows = [];
    let offset = 0;
    while (true) {
        let query = supabase_1.supabase.from(table).select(columns).order('id', { ascending: true }).range(offset, offset + pageSize - 1);
        if (configure)
            query = configure(query);
        const { data, error } = await query;
        if (error)
            throw error;
        const page = data || [];
        rows.push(...page);
        if (page.length < pageSize)
            break;
        offset += pageSize;
    }
    return rows;
}
function mapUsers(users) {
    return users.map(user => {
        const sectionIds = (0, helpers_1.parseSectionIds)(user.section_id);
        return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            studentNumber: user.student_number || undefined,
            sectionId: sectionIds[0] || undefined,
            sectionIds,
            avatar: user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(user.name)}`,
            department: user.department || undefined,
            title: user.title || undefined,
        };
    });
}
function mapSections(sections) {
    return sections.map(section => {
        const decoded = (0, helpers_1.decodeSectionDescription)(section.description);
        return {
            id: section.id,
            name: section.name,
            gradeLevelOrYear: section.grade_level_or_year,
            academicYear: section.academic_year,
            semester: section.semester,
            room: section.room || undefined,
            description: decoded.description || undefined,
            adviserId: decoded.adviserId,
        };
    });
}
function mapTemplates(templates) {
    return templates
        .filter(template => template.id !== 'sys-auth-vault')
        .map(template => {
        let matrix = template.matrix || [];
        let useTransmutation = true;
        if (matrix && !Array.isArray(matrix) && typeof matrix === 'object') {
            useTransmutation = matrix.useTransmutation !== false;
            matrix = matrix.categories || [];
        }
        return {
            id: template.id,
            name: template.name,
            description: template.description || undefined,
            isDefault: template.is_default ?? false,
            passingGrade: template.passing_grade ?? 75,
            matrix,
            useTransmutation,
        };
    });
}
function mapSubjects(subjects) {
    return subjects.map(subject => {
        let matrix = subject.matrix || [];
        let useTransmutation = true;
        if (matrix && !Array.isArray(matrix) && typeof matrix === 'object') {
            useTransmutation = matrix.useTransmutation !== false;
            matrix = matrix.categories || [];
        }
        return {
            id: subject.id,
            sectionId: subject.section_id,
            teacherId: subject.teacher_id,
            name: subject.name,
            code: subject.code,
            schedule: subject.schedule || undefined,
            units: subject.units,
            passingGrade: subject.passing_grade ?? 75,
            matrix,
            useTransmutation,
        };
    });
}
/** GET /api/faculty/dashboard */
router.get('/dashboard', async (req, res) => {
    if (!supabase_1.isSupabaseConfigured || !supabase_1.supabase) {
        res.status(503).json({ error: 'Database not configured' });
        return;
    }
    try {
        const isDean = req.user?.role === 'dean';
        const [rawTemplates, rawHolidays] = await Promise.all([
            fetchAllRows('grading_matrix_templates', 'id,name,description,is_default,passing_grade,matrix'),
            fetchAllRows('holidays', 'id,date,title,type,description'),
        ]);
        let rawUsers;
        let rawSections;
        let rawSubjects;
        let rawAssessments;
        let rawScores;
        let rawAttendance;
        if (isDean) {
            [rawUsers, rawSections, rawSubjects, rawAssessments, rawScores, rawAttendance] = await Promise.all([
                fetchAllRows('users', 'id,name,email,role,student_number,section_id,avatar,department,title'),
                fetchAllRows('sections', 'id,name,grade_level_or_year,academic_year,semester,room,description'),
                fetchAllRows('subjects', 'id,section_id,teacher_id,name,code,schedule,units,passing_grade,matrix'),
                fetchAllRows('assessments', 'id,subject_id,category_id,parent_category_id,period,title,max_score,date,due_date,description'),
                fetchAllRows('score_records', 'id,assessment_id,student_id,score,remarks,submitted_at'),
                fetchAllRows('attendance_records', 'id,subject_id,student_id,date,period,status,note'),
            ]);
        }
        else {
            rawSubjects = await fetchAllRows('subjects', 'id,section_id,teacher_id,name,code,schedule,units,passing_grade,matrix', query => query.eq('teacher_id', req.user.userId));
            const subjectIds = rawSubjects.map(subject => subject.id);
            const sectionIds = [...new Set(rawSubjects.map(subject => subject.section_id).filter(Boolean))];
            const assessmentQuery = subjectIds.length
                ? fetchAllRows('assessments', 'id,subject_id,category_id,parent_category_id,period,title,max_score,date,due_date,description', query => query.in('subject_id', subjectIds))
                : Promise.resolve([]);
            const sectionQuery = sectionIds.length
                ? fetchAllRows('sections', 'id,name,grade_level_or_year,academic_year,semester,room,description', query => query.in('id', sectionIds))
                : Promise.resolve([]);
            const userFilters = [`id.eq.${req.user.userId}`, ...sectionIds.map(sectionId => `section_id.ilike.%${sectionId}%`)].join(',');
            const userQuery = fetchAllRows('users', 'id,name,email,role,student_number,section_id,avatar,department,title', query => query.or(userFilters));
            [rawSections, rawUsers, rawAssessments] = await Promise.all([sectionQuery, userQuery, assessmentQuery]);
            const assessmentIds = rawAssessments.map(assessment => assessment.id);
            [rawScores, rawAttendance] = await Promise.all([
                assessmentIds.length
                    ? fetchAllRows('score_records', 'id,assessment_id,student_id,score,remarks,submitted_at', query => query.in('assessment_id', assessmentIds))
                    : Promise.resolve([]),
                subjectIds.length
                    ? fetchAllRows('attendance_records', 'id,subject_id,student_id,date,period,status,note', query => query.in('subject_id', subjectIds))
                    : Promise.resolve([]),
            ]);
        }
        res.json({
            users: mapUsers(rawUsers),
            sections: mapSections(rawSections),
            subjects: mapSubjects(rawSubjects),
            assessments: rawAssessments.map(assessment => ({
                id: assessment.id,
                subjectId: assessment.subject_id,
                categoryId: assessment.category_id,
                parentCategoryId: assessment.parent_category_id || undefined,
                period: assessment.period || 'prelim',
                title: assessment.title,
                maxScore: assessment.max_score,
                date: assessment.date,
                dueDate: assessment.due_date || undefined,
                description: assessment.description || undefined,
            })),
            scores: rawScores.map(score => ({
                id: score.id,
                assessmentId: score.assessment_id,
                studentId: score.student_id,
                score: score.score,
                remarks: score.remarks || undefined,
                submittedAt: score.submitted_at,
            })),
            attendance: rawAttendance.map(record => ({
                id: record.id,
                subjectId: record.subject_id,
                studentId: record.student_id,
                date: record.date,
                period: record.period || 'prelim',
                status: record.status,
                note: record.note || undefined,
            })),
            matrixTemplates: mapTemplates(rawTemplates),
            holidays: rawHolidays.map(holiday => ({
                id: holiday.id,
                date: holiday.date,
                title: holiday.title,
                type: holiday.type,
                description: holiday.description || undefined,
            })),
        });
    }
    catch (error) {
        console.error('Faculty dashboard error:', error);
        res.status(500).json({ error: 'Failed to load faculty dashboard' });
    }
});
exports.default = router;
