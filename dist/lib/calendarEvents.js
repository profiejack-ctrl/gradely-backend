"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCalendarEvents = getCalendarEvents;
exports.saveCalendarEvents = saveCalendarEvents;
exports.addCalendarEvent = addCalendarEvent;
exports.updateCalendarEvent = updateCalendarEvent;
exports.deleteCalendarEvent = deleteCalendarEvent;
const supabase_1 = require("./supabase");
async function getCalendarEvents() {
    if (!supabase_1.supabase)
        return [];
    const events = [];
    const seenIds = new Set();
    // 1. Fetch custom events stored in sys-calendar-events
    try {
        const { data: tmplData } = await supabase_1.supabase
            .from('grading_matrix_templates')
            .select('matrix')
            .eq('id', 'sys-calendar-events')
            .maybeSingle();
        if (tmplData && Array.isArray(tmplData.matrix)) {
            for (const item of tmplData.matrix) {
                if (item && item.id && item.title && item.date) {
                    seenIds.add(item.id);
                    events.push({
                        id: item.id,
                        title: item.title,
                        type: item.type || 'activity',
                        date: item.date,
                        endDate: item.endDate || undefined,
                        time: item.time || undefined,
                        location: item.location || undefined,
                        description: item.description || undefined,
                        subjectId: item.subjectId || undefined,
                        subjectName: item.subjectName || undefined,
                        createdBy: item.createdBy || undefined,
                        createdAt: item.createdAt || undefined,
                    });
                }
            }
        }
    }
    catch (err) {
        console.warn('[calendarEvents] Warning fetching sys-calendar-events:', err);
    }
    // 2. Fetch holidays from public.holidays
    try {
        const { data: holidays } = await supabase_1.supabase
            .from('holidays')
            .select('id,date,title,type,description,created_at')
            .order('date', { ascending: true });
        if (holidays && holidays.length > 0) {
            for (const h of holidays) {
                const hId = `hol-${h.id}`;
                if (!seenIds.has(h.id) && !seenIds.has(hId)) {
                    seenIds.add(h.id);
                    events.push({
                        id: h.id,
                        title: h.title,
                        type: 'holiday',
                        date: h.date,
                        description: h.description || `${h.type?.toUpperCase()} Holiday`,
                        location: 'Campus-wide / National',
                        createdAt: h.created_at || undefined,
                    });
                }
            }
        }
    }
    catch (err) {
        console.warn('[calendarEvents] Warning fetching holidays:', err);
    }
    // 3. Fetch major examinations from public.assessments
    try {
        const { data: examAssessments } = await supabase_1.supabase
            .from('assessments')
            .select('id,title,date,due_date,period,subject_id,description')
            .or('title.ilike.%exam%,title.ilike.%periodical%,category_id.ilike.%exam%,category_id.ilike.%we%')
            .order('date', { ascending: true });
        if (examAssessments && examAssessments.length > 0) {
            for (const a of examAssessments) {
                const aId = `exam-${a.id}`;
                if (!seenIds.has(a.id) && !seenIds.has(aId)) {
                    seenIds.add(a.id);
                    events.push({
                        id: aId,
                        title: a.title,
                        type: 'exam',
                        date: a.date,
                        endDate: a.due_date || undefined,
                        description: a.description || `${(a.period || 'Periodical').toUpperCase()} Examination`,
                        location: 'Designated Classrooms & Testing Labs',
                        subjectId: a.subject_id || undefined,
                    });
                }
            }
        }
    }
    catch (err) {
        console.warn('[calendarEvents] Warning fetching exam assessments:', err);
    }
    // Sort chronologically by date
    events.sort((a, b) => a.date.localeCompare(b.date));
    return events;
}
async function saveCalendarEvents(events) {
    if (!supabase_1.supabase)
        return false;
    // Filter to only user-created events for sys-calendar-events storage
    const customEvents = events.filter(e => !e.id.startsWith('hol-') && !e.id.startsWith('exam-'));
    const { error } = await supabase_1.supabase
        .from('grading_matrix_templates')
        .upsert({
        id: 'sys-calendar-events',
        name: 'Calendar Events Storage',
        description: 'System storage for school calendar events, exams, holidays, and campus activities',
        matrix: customEvents,
        updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    if (error) {
        console.error('[calendarEvents] Error saving sys-calendar-events:', error);
        return false;
    }
    return true;
}
async function addCalendarEvent(eventData) {
    const currentEvents = await getCalendarEvents();
    const newEvent = {
        ...eventData,
        id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        createdAt: new Date().toISOString(),
    };
    currentEvents.push(newEvent);
    const ok = await saveCalendarEvents(currentEvents);
    return ok ? newEvent : null;
}
async function updateCalendarEvent(id, updates) {
    const currentEvents = await getCalendarEvents();
    const idx = currentEvents.findIndex(e => e.id === id);
    if (idx < 0)
        return null;
    currentEvents[idx] = {
        ...currentEvents[idx],
        ...updates,
        id, // Preserve ID
    };
    const ok = await saveCalendarEvents(currentEvents);
    return ok ? currentEvents[idx] : null;
}
async function deleteCalendarEvent(id) {
    if (!supabase_1.supabase)
        return false;
    // If it's a holiday in public.holidays
    if (id.startsWith('hol-') || id.startsWith('hol')) {
        const rawId = id.replace(/^hol-/, '');
        await supabase_1.supabase.from('holidays').delete().or(`id.eq.${id},id.eq.${rawId}`);
    }
    const currentEvents = await getCalendarEvents();
    const filtered = currentEvents.filter(e => e.id !== id && e.id !== `hol-${id}` && e.id !== `exam-${id}`);
    return await saveCalendarEvents(filtered);
}
