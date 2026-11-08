export type UserRole = 'dean' | 'teacher' | 'student';
export type GradingPeriod = 'prelim' | 'midterm' | 'finals';
export type AttendanceStatus = 'present' | 'late' | 'absent' | 'excused';
export type GradeDisplayMode = 'raw_only' | 'transmuted_only' | 'both';
export type ScheduleMode = 'f2f' | 'online';
export type DayOfWeek = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';

export interface ScheduleSession {
  mode: ScheduleMode;
  day: DayOfWeek;
  startTime: string; // e.g. "08:00"
  endTime: string;   // e.g. "10:00"
  room?: string;     // For F2F
  meetingUrl?: string; // For Online
}

export interface User {
  id: string;
  name: string;
  firstName?: string;
  lastName?: string;
  email: string;
  role: UserRole;
  avatar: string;
  profilePicture?: string;
  studentId?: string;
  studentNumber?: string;
  address?: string;
  contactNumber?: string;
  sectionId?: string;
  sectionIds?: string[];
  title?: string;
  department?: string;
  mustChangePassword?: boolean;
}

export interface Section {
  id: string;
  name: string;
  gradeLevelOrYear: string;
  academicYear: string;
  semester: string;
  description?: string;
  room?: string;
  adviserId?: string;
}

export interface MatrixSubCategory {
  id: string;
  name: string;
  weight: number;
  description?: string;
  isTransmutable?: boolean;
}

export interface MatrixCategory {
  id: string;
  name: string;
  weight: number;
  description?: string;
  color?: string;
  subCategories?: MatrixSubCategory[];
  isTransmutable?: boolean;
  isAttendance?: boolean;
}

export interface GradingMatrixTemplate {
  id: string;
  name: string;
  description?: string;
  isDefault?: boolean;
  passingGrade: number;
  gradeDisplayMode?: GradeDisplayMode;
  matrix: MatrixCategory[];
  useTransmutation?: boolean;
}

export interface Subject {
  id: string;
  sectionId: string;
  name: string;
  code: string;
  teacherId: string;
  passingGrade: number;
  gradingMatrixTemplateId?: string;
  gradeDisplayMode?: GradeDisplayMode;
  customMatrix?: MatrixCategory[];
  matrix: MatrixCategory[];
  schedule?: ScheduleSession[] | string;
  units?: number;
  useTransmutation?: boolean;
}

export interface Assessment {
  id: string;
  subjectId: string;
  categoryId: string;
  parentCategoryId?: string;
  period?: GradingPeriod;
  title: string;
  maxScore: number;
  date: string;
  dueDate?: string;
  description?: string;
  isAttendance?: boolean;
}

export interface ScoreRecord {
  id: string;
  assessmentId: string;
  studentId: string;
  score: number;
  submittedAt?: string;
  remarks?: string;
}

export interface AttendanceRecord {
  id: string;
  subjectId: string;
  studentId: string;
  date: string;
  status: AttendanceStatus;
  period?: GradingPeriod;
  note?: string;
}

export interface Holiday {
  id: string;
  date: string;
  title: string;
  type: 'national' | 'school' | 'suspension' | 'break';
  description?: string;
}

export interface AuthPayload {
  userId: string;
  email: string;
  role: UserRole;
  name: string;
}
