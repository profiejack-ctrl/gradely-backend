"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const calendarEvents_1 = require("../lib/calendarEvents");
const router = (0, express_1.Router)();
/**
 * GET /api/events
 * Returns all calendar events (exams, holidays, school activities, etc.)
 */
router.get('/', async (_req, res) => {
    try {
        const events = await (0, calendarEvents_1.getCalendarEvents)();
        res.json({ events });
    }
    catch (error) {
        console.error('Failed to load events:', error);
        res.status(500).json({ error: 'Failed to fetch calendar events' });
    }
});
/**
 * POST /api/events
 * Creates a new calendar event (Faculty or Dean access)
 */
router.post('/', auth_1.requireAuth, auth_1.requireFaculty, async (req, res) => {
    const { title, type, date, endDate, time, location, description, subjectId, subjectName } = req.body;
    if (!title || !date) {
        res.status(400).json({ error: 'Event title and date are required' });
        return;
    }
    const validTypes = ['exam', 'holiday', 'activity', 'class'];
    const eventType = validTypes.includes(type) ? type : 'activity';
    try {
        const newEvent = await (0, calendarEvents_1.addCalendarEvent)({
            title: String(title).trim(),
            type: eventType,
            date: String(date).trim(),
            endDate: endDate ? String(endDate).trim() : undefined,
            time: time ? String(time).trim() : undefined,
            location: location ? String(location).trim() : undefined,
            description: description ? String(description).trim() : undefined,
            subjectId: subjectId ? String(subjectId).trim() : undefined,
            subjectName: subjectName ? String(subjectName).trim() : undefined,
            createdBy: req.user?.userId,
        });
        if (!newEvent) {
            res.status(500).json({ error: 'Failed to save event to database' });
            return;
        }
        res.status(201).json({ success: true, event: newEvent });
    }
    catch (error) {
        console.error('Failed to create event:', error);
        res.status(500).json({ error: 'Internal server error creating event' });
    }
});
/**
 * PUT /api/events/:id
 * Updates an existing calendar event (Faculty or Dean access)
 */
router.put('/:id', auth_1.requireAuth, auth_1.requireFaculty, async (req, res) => {
    const { id } = req.params;
    const { title, type, date, endDate, time, location, description, subjectId, subjectName } = req.body;
    try {
        const updated = await (0, calendarEvents_1.updateCalendarEvent)(id, {
            ...(title && { title: String(title).trim() }),
            ...(type && { type }),
            ...(date && { date: String(date).trim() }),
            ...(endDate !== undefined && { endDate: endDate ? String(endDate).trim() : undefined }),
            ...(time !== undefined && { time: time ? String(time).trim() : undefined }),
            ...(location !== undefined && { location: location ? String(location).trim() : undefined }),
            ...(description !== undefined && { description: description ? String(description).trim() : undefined }),
            ...(subjectId !== undefined && { subjectId: subjectId ? String(subjectId).trim() : undefined }),
            ...(subjectName !== undefined && { subjectName: subjectName ? String(subjectName).trim() : undefined }),
        });
        if (!updated) {
            res.status(404).json({ error: 'Event not found or failed to update' });
            return;
        }
        res.json({ success: true, event: updated });
    }
    catch (error) {
        console.error('Failed to update event:', error);
        res.status(500).json({ error: 'Internal server error updating event' });
    }
});
/**
 * DELETE /api/events/:id
 * Removes an event from the calendar (Faculty or Dean access)
 */
router.delete('/:id', auth_1.requireAuth, auth_1.requireFaculty, async (req, res) => {
    const { id } = req.params;
    try {
        const ok = await (0, calendarEvents_1.deleteCalendarEvent)(id);
        if (!ok) {
            res.status(500).json({ error: 'Failed to delete event' });
            return;
        }
        res.json({ success: true, message: 'Event deleted successfully' });
    }
    catch (error) {
        console.error('Failed to delete event:', error);
        res.status(500).json({ error: 'Internal server error deleting event' });
    }
});
exports.default = router;
