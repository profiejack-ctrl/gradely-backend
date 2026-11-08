"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCourseCatalog = getCourseCatalog;
exports.saveCourseCatalog = saveCourseCatalog;
exports.addCourseToCatalog = addCourseToCatalog;
exports.deleteCourseFromCatalog = deleteCourseFromCatalog;
const supabase_1 = require("./supabase");
async function getCourseCatalog() {
    if (!supabase_1.supabase)
        return [];
    // 1. Fetch from sys-course-catalog record in grading_matrix_templates
    const { data, error } = await supabase_1.supabase
        .from('grading_matrix_templates')
        .select('matrix')
        .eq('id', 'sys-course-catalog')
        .maybeSingle();
    let catalog = [];
    if (!error && data && Array.isArray(data.matrix)) {
        catalog = data.matrix;
    }
    // 2. Also incorporate distinct courses from existing subjects
    const { data: subjects } = await supabase_1.supabase
        .from('subjects')
        .select('name,code,units,passing_grade,grading_matrix_template_id,matrix')
        .order('created_at', { ascending: true });
    if (subjects && subjects.length > 0) {
        subjects.forEach((sub) => {
            const codeUpper = (sub.code || '').trim().toUpperCase();
            if (!codeUpper)
                return;
            const exists = catalog.some((c) => c.code.trim().toUpperCase() === codeUpper);
            if (!exists) {
                catalog.push({
                    id: `crs-${codeUpper.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
                    name: sub.name,
                    code: codeUpper,
                    units: Number(sub.units) || 3,
                    passingGrade: Number(sub.passing_grade) || 75,
                    gradingMatrixTemplateId: sub.grading_matrix_template_id || undefined,
                    matrix: sub.matrix || undefined,
                    department: 'College of Computing Studies',
                    createdAt: new Date().toISOString(),
                });
            }
        });
    }
    return catalog;
}
async function saveCourseCatalog(courses) {
    if (!supabase_1.supabase)
        return false;
    const { error } = await supabase_1.supabase.from('grading_matrix_templates').upsert({
        id: 'sys-course-catalog',
        name: '__course_catalog__',
        description: 'System master course curriculum catalog - do not delete',
        is_default: false,
        passing_grade: 75,
        matrix: courses,
    });
    if (error) {
        console.error('Failed to save course catalog:', error);
        return false;
    }
    return true;
}
async function addCourseToCatalog(entry) {
    const current = await getCourseCatalog();
    const codeUpper = entry.code.trim().toUpperCase();
    const existingIdx = current.findIndex((c) => c.code.trim().toUpperCase() === codeUpper);
    const courseItem = {
        id: existingIdx >= 0
            ? current[existingIdx].id
            : `crs-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`,
        name: entry.name.trim(),
        code: codeUpper,
        units: Number(entry.units) || 3,
        passingGrade: Number(entry.passingGrade) || 75,
        gradingMatrixTemplateId: entry.gradingMatrixTemplateId,
        matrix: entry.matrix,
        department: entry.department || 'College of Computing Studies',
        createdAt: new Date().toISOString(),
    };
    if (existingIdx >= 0) {
        current[existingIdx] = courseItem;
    }
    else {
        current.push(courseItem);
    }
    await saveCourseCatalog(current);
    return courseItem;
}
async function deleteCourseFromCatalog(courseId) {
    const current = await getCourseCatalog();
    const filtered = current.filter((c) => c.id !== courseId && c.code.toUpperCase() !== courseId.toUpperCase());
    return await saveCourseCatalog(filtered);
}
