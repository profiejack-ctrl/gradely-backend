import { ScheduleSession, DayOfWeek, ScheduleMode } from '../types';

/**
 * Encodes adviser ID into the section description field
 * Format: "[adviser:UUID] actual description"
 */
export function encodeSectionDescription(description?: string, adviserId?: string): string {
  if (!adviserId) return description || '';
  const base = description ? description.replace(/^\[adviser:[^\]]+\]\s*/, '').trim() : '';
  return `[adviser:${adviserId}]${base ? ` ${base}` : ''}`;
}

/**
 * Decodes adviser ID from the section description field
 */
export function decodeSectionDescription(raw?: string | null): { description: string; adviserId?: string } {
  if (!raw) return { description: '' };
  const match = raw.match(/^\[adviser:([^\]]+)\]\s*(.*)$/);
  if (match) {
    return { description: match[2].trim(), adviserId: match[1] };
  }
  return { description: raw };
}

/**
 * Parses a comma-separated section_id string into an array of section IDs
 */
export function parseSectionIds(raw?: string | null): string[] {
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Formats an array of section IDs into a comma-separated string
 */
export function formatSectionIds(ids: string[]): string {
  return [...new Set(ids)].filter(Boolean).join(',');
}

/**
 * Generates a short unique ID
 */
export function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}`;
}

/**
 * Transmutes a raw score using standard BCP / DepEd 50-base transmutation.
 * - If no attempt (rawScore is undefined/null/NaN): Transmutes to 50.0 (no attempt floor).
 * - If attempt made (including 0):
 *   - rawPercent = 0% -> Transmutes to 65.0
 *   - rawPercent < 50%: Transmutes from 65.0 to 75.0 (65 + rawPercent * 0.2)
 *   - rawPercent >= 50%: Transmutes from 75.0 to 100.0 (75 + (rawPercent - 50) * 0.5)
 */
export function transmuteScore(
  rawScore?: number | null,
  maxScore: number = 100,
  passingGrade: number = 75
): { rawPercent: number; transmutedGrade: number; hasAttempt: boolean } {
  const safeMax = Number(maxScore) > 0 ? Number(maxScore) : 100;

  if (rawScore === undefined || rawScore === null || isNaN(Number(rawScore))) {
    return {
      rawPercent: 0,
      transmutedGrade: 50,
      hasAttempt: false,
    };
  }

  const rawPercent = Math.min(100, Math.max(0, (Number(rawScore) / safeMax) * 100));
  let transmutedGrade: number;

  if (rawPercent < 50) {
    transmutedGrade = 65 + (rawPercent / 50) * 10;
  } else {
    transmutedGrade = 75 + (rawPercent - 50) * 0.5;
  }

  return {
    rawPercent: Math.round(rawPercent * 10) / 10,
    transmutedGrade: Math.round(transmutedGrade * 10) / 10,
    hasAttempt: true,
  };
}

const VALID_DAYS: Set<DayOfWeek> = new Set([
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]);

/**
 * Parses and normalizes schedule data into structured 2-session (F2F + Online) format.
 * Gracefully handles legacy strings like "MWF 6:00 AM - 8:00 AM" or structured JSON arrays.
 */
export function parseSchedule(raw: any): ScheduleSession[] {
  if (!raw) return [];

  // If already an array of structured sessions
  if (Array.isArray(raw)) {
    return raw
      .filter(item => item && typeof item === 'object')
      .map(item => ({
        mode: (item.mode === 'online' ? 'online' : 'f2f') as ScheduleMode,
        day: VALID_DAYS.has(item.day) ? item.day : 'Monday',
        startTime: String(item.startTime || item.start_time || '08:00'),
        endTime: String(item.endTime || item.end_time || '10:00'),
        room: item.room ? String(item.room) : undefined,
        meetingUrl: item.meetingUrl || item.meeting_url ? String(item.meetingUrl || item.meeting_url) : undefined,
      }));
  }

  // If parsed from JSON string
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parseSchedule(parsed);
      } catch {
        // Fallback to legacy string parsing
      }
    }

    // Legacy fallback string representation: create default 2-session split (1 F2F, 1 Online)
    return [
      {
        mode: 'f2f',
        day: 'Monday',
        startTime: '08:00',
        endTime: '10:00',
        room: 'TBA',
      },
      {
        mode: 'online',
        day: 'Thursday',
        startTime: '08:00',
        endTime: '10:00',
        meetingUrl: 'https://meet.google.com',
      },
    ];
  }

  return [];
}

/**
 * Calculates attendance metrics and equivalent grade percentage from attendance records.
 * Rules:
 * - Present = 1.0 unit
 * - Excused = 1.0 unit
 * - Late = 0.5 unit
 * - Absent = 0.0 units
 */
export function calculateAttendanceMetrics(records: any[]): {
  total: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  presentUnits: number;
  attendancePercent: number;
} {
  const safeRecords = Array.isArray(records) ? records : [];
  const total = safeRecords.length;

  let present = 0;
  let late = 0;
  let absent = 0;
  let excused = 0;
  let presentUnits = 0;

  for (const record of safeRecords) {
    const status = String(record?.status || '').toLowerCase();
    if (status === 'present') {
      present += 1;
      presentUnits += 1;
    } else if (status === 'excused') {
      excused += 1;
      presentUnits += 1;
    } else if (status === 'late') {
      late += 1;
      presentUnits += 0.5;
    } else {
      absent += 1;
    }
  }

  const attendancePercent = total > 0 ? Math.round((presentUnits / total) * 1000) / 10 : 100;

  return {
    total,
    present,
    late,
    absent,
    excused,
    presentUnits,
    attendancePercent,
  };
}

/**
 * Returns the current day of the week name (e.g. "Monday", "Tuesday")
 */
export function getDayOfWeek(date: Date = new Date()): DayOfWeek {
  const days: DayOfWeek[] = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  return days[date.getDay()];
}
