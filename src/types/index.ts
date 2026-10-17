export type UserRole = 'dean' | 'teacher' | 'student';
export type GradingPeriod = 'prelim' | 'midterm' | 'finals';
export type AttendanceStatus = 'present' | 'late' | 'absent' | 'excused';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar: string;
  studentNumber?: string;
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
}

export interface MatrixCategory {
  id: string;
  name: string;
  weight: number;
  description?: string;
  color?: string;
  subCategories?: MatrixSubCategory[];
}

export interface GradingMatrixTemplate {
  id: string;
  name: string;
  description?: string;
  isDefault?: boolean;
  passingGrade: number;
  matrix: MatrixCategory[];
}

export interface Subject {
  id: string;
  sectionId: string;
  name: string;
  code: string;
  teacherId: string;
  passingGrade: number;
  matrix: MatrixCategory[];
  schedule?: string;
  units?: number;
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
