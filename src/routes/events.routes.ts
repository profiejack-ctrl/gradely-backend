import { Router, Request, Response } from 'express';
import { requireAuth, requireFaculty, AuthRequest } from '../middleware/auth';
import {
  getCalendarEvents,
  addCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  CalendarEvent,
} from '../lib/calendarEvents';

const router = Router();

/**
 * GET /api/events
 * Returns all calendar events (exams, holidays, school activities, etc.)
 */
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const events = await getCalendarEvents();
    res.json({ events });
  } catch (error: any) {
    console.error('Failed to load events:', error);
    res.status(500).json({ error: 'Failed to fetch calendar events' });
  }
});

/**
 * POST /api/events
 * Creates a new calendar event (Faculty or Dean access)
 */
router.post('/', requireAuth, requireFaculty, async (req: AuthRequest, res: Response): Promise<void> => {
  const { title, type, date, endDate, time, location, description, subjectId, subjectName } = req.body;

  if (!title || !date) {
    res.status(400).json({ error: 'Event title and date are required' });
    return;
  }

  const validTypes = ['exam', 'holiday', 'activity', 'class'];
  const eventType = validTypes.includes(type) ? type : 'activity';

  try {
    const newEvent = await addCalendarEvent({
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
  } catch (error: any) {
    console.error('Failed to create event:', error);
    res.status(500).json({ error: 'Internal server error creating event' });
  }
});

/**
 * PUT /api/events/:id
 * Updates an existing calendar event (Faculty or Dean access)
 */
router.put('/:id', requireAuth, requireFaculty, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { title, type, date, endDate, time, location, description, subjectId, subjectName } = req.body;

  try {
    const updated = await updateCalendarEvent(id, {
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
  } catch (error: any) {
    console.error('Failed to update event:', error);
    res.status(500).json({ error: 'Internal server error updating event' });
  }
});

/**
 * DELETE /api/events/:id
 * Removes an event from the calendar (Faculty or Dean access)
 */
router.delete('/:id', requireAuth, requireFaculty, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    const ok = await deleteCalendarEvent(id);
    if (!ok) {
      res.status(500).json({ error: 'Failed to delete event' });
      return;
    }

    res.json({ success: true, message: 'Event deleted successfully' });
  } catch (error: any) {
    console.error('Failed to delete event:', error);
    res.status(500).json({ error: 'Internal server error deleting event' });
  }
});

export default router;
