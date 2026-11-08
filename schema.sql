-- =============================================================================
-- GRADELY STUDENT MANAGEMENT SYSTEM - DATABASE SCHEMA (REVISED)
-- PostgreSQL / Supabase Migration
-- =============================================================================

-- Enable UUID extension if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- 1. USERS & ROLES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
    id VARCHAR(160) PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    email VARCHAR(255) UNIQUE NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('dean', 'teacher', 'student')),
    student_number VARCHAR(64) UNIQUE,
    address TEXT,
    contact_number VARCHAR(30),
    section_id TEXT, -- Legacy compatibility / primary section
    avatar TEXT,
    title VARCHAR(120),
    department VARCHAR(160),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Safely add profile columns if the table already existed previously
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS first_name VARCHAR(100);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_name VARCHAR(100);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS contact_number VARCHAR(30);

-- Index for quick lookups on student number and email
CREATE INDEX IF NOT EXISTS idx_users_student_number ON public.users(student_number);
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);

-- -----------------------------------------------------------------------------
-- 2. SECTIONS & ROSTERS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sections (
    id VARCHAR(160) PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    grade_level_or_year VARCHAR(50) NOT NULL,
    academic_year VARCHAR(50) NOT NULL,
    semester VARCHAR(50) NOT NULL,
    room VARCHAR(50),
    adviser_id VARCHAR(160) REFERENCES public.users(id) ON DELETE SET NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Normalized student-to-section enrollments
CREATE TABLE IF NOT EXISTS public.student_enrollments (
    student_id VARCHAR(160) NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    section_id VARCHAR(160) NOT NULL REFERENCES public.sections(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (student_id, section_id)
);

CREATE INDEX IF NOT EXISTS idx_enrollments_student ON public.student_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_section ON public.student_enrollments(section_id);

-- -----------------------------------------------------------------------------
-- 3. GRADING MATRIX TEMPLATES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.grading_matrix_templates (
    id VARCHAR(160) PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    description TEXT,
    is_default BOOLEAN DEFAULT FALSE,
    passing_grade NUMERIC(5, 2) DEFAULT 75.00,
    grade_display_mode VARCHAR(20) DEFAULT 'both' CHECK (grade_display_mode IN ('raw_only', 'transmuted_only', 'both')),
    matrix JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4. SUBJECTS (COURSES)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subjects (
    id VARCHAR(160) PRIMARY KEY,
    section_id VARCHAR(160) NOT NULL REFERENCES public.sections(id) ON DELETE CASCADE,
    teacher_id VARCHAR(160) NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    grading_matrix_template_id VARCHAR(160) REFERENCES public.grading_matrix_templates(id) ON DELETE SET NULL,
    name VARCHAR(160) NOT NULL,
    code VARCHAR(50) NOT NULL,
    units NUMERIC(3, 1) DEFAULT 3.0,
    passing_grade NUMERIC(5, 2) DEFAULT 75.00,
    grade_display_mode VARCHAR(20) DEFAULT 'both' CHECK (grade_display_mode IN ('raw_only', 'transmuted_only', 'both')),
    custom_matrix JSONB, -- Optional override if teacher has special permission
    matrix JSONB DEFAULT '[]'::jsonb, -- Backwards compatibility
    schedule JSONB NOT NULL DEFAULT '[]'::jsonb, -- Structured 2-session array: [{"mode":"f2f","day":"Monday",...},{"mode":"online",...}]
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Safely add revised columns if the table already existed previously
ALTER TABLE public.subjects ADD COLUMN IF NOT EXISTS grading_matrix_template_id VARCHAR(160) REFERENCES public.grading_matrix_templates(id) ON DELETE SET NULL;
ALTER TABLE public.subjects ADD COLUMN IF NOT EXISTS grade_display_mode VARCHAR(20) DEFAULT 'both';
ALTER TABLE public.subjects ADD COLUMN IF NOT EXISTS custom_matrix JSONB;
ALTER TABLE public.subjects ADD COLUMN IF NOT EXISTS schedule JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.grading_matrix_templates ADD COLUMN IF NOT EXISTS grade_display_mode VARCHAR(20) DEFAULT 'both';

CREATE INDEX IF NOT EXISTS idx_subjects_teacher ON public.subjects(teacher_id);
CREATE INDEX IF NOT EXISTS idx_subjects_section ON public.subjects(section_id);
CREATE INDEX IF NOT EXISTS idx_subjects_template ON public.subjects(grading_matrix_template_id);

-- -----------------------------------------------------------------------------
-- 5. ASSESSMENTS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assessments (
    id VARCHAR(160) PRIMARY KEY,
    subject_id VARCHAR(160) NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
    category_id VARCHAR(80) NOT NULL,
    parent_category_id VARCHAR(80),
    period VARCHAR(20) NOT NULL CHECK (period IN ('prelim', 'midterm', 'finals')),
    title VARCHAR(200) NOT NULL,
    max_score NUMERIC(8, 2) NOT NULL CHECK (max_score > 0),
    date DATE NOT NULL,
    due_date DATE,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assessments_subject ON public.assessments(subject_id);
CREATE INDEX IF NOT EXISTS idx_assessments_period ON public.assessments(period);

-- -----------------------------------------------------------------------------
-- 6. SCORE RECORDS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.score_records (
    id VARCHAR(160) PRIMARY KEY,
    assessment_id VARCHAR(160) NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
    student_id VARCHAR(160) NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    score NUMERIC(8, 2) NOT NULL CHECK (score >= 0),
    remarks TEXT,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_assessment_student UNIQUE (assessment_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_scores_student ON public.score_records(student_id);
CREATE INDEX IF NOT EXISTS idx_scores_assessment ON public.score_records(assessment_id);

-- -----------------------------------------------------------------------------
-- 7. ATTENDANCE RECORDS (TAP-IN LOGS)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_records (
    id VARCHAR(160) PRIMARY KEY,
    subject_id VARCHAR(160) NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
    student_id VARCHAR(160) NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    period VARCHAR(20) NOT NULL CHECK (period IN ('prelim', 'midterm', 'finals')),
    status VARCHAR(20) NOT NULL CHECK (status IN ('present', 'late', 'absent', 'excused')),
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_attendance_entry UNIQUE (subject_id, student_id, date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_student_subject ON public.attendance_records(student_id, subject_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON public.attendance_records(date);

-- -----------------------------------------------------------------------------
-- 8. HOLIDAYS & SUSPENSIONS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.holidays (
    id VARCHAR(160) PRIMARY KEY,
    date DATE NOT NULL,
    title VARCHAR(160) NOT NULL,
    type VARCHAR(30) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 9. AUDIT LOGS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id BIGSERIAL PRIMARY KEY,
    actor_id VARCHAR(160),
    actor_role VARCHAR(20),
    action VARCHAR(60) NOT NULL,
    table_name VARCHAR(60),
    record_id VARCHAR(160),
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON public.audit_logs(created_at DESC);

-- =============================================================================
-- SEED DATA: DEFAULT GRADING MATRIX TEMPLATES & DEAN
-- =============================================================================

-- Default College Grading Matrix Template (with integrated Attendance)
INSERT INTO public.grading_matrix_templates (
    id,
    name,
    description,
    is_default,
    passing_grade,
    grade_display_mode,
    matrix
) VALUES (
    'tmpl-college-standard',
    'Standard College Lecture with Laboratory',
    'Standard CHED-compliant matrix with attendance, quizzes, lab tasks, and periodical exam.',
    TRUE,
    75.00,
    'both',
    '[
        {
            "id": "attendance",
            "name": "Attendance & Class Participation",
            "weight": 10,
            "isAttendance": true,
            "color": "#10B981"
        },
        {
            "id": "written_works",
            "name": "Quizzes & Written Works",
            "weight": 25,
            "color": "#3B82F6"
        },
        {
            "id": "performance_tasks",
            "name": "Laboratory & Hands-on Performance Tasks",
            "weight": 35,
            "color": "#8B5CF6"
        },
        {
            "id": "major_exam",
            "name": "Periodical Examination",
            "weight": 30,
            "color": "#F59E0B"
        }
    ]'::jsonb
) ON CONFLICT (id) DO NOTHING;

-- Default Dean Account
INSERT INTO public.users (
    id,
    name,
    email,
    role,
    avatar,
    title,
    department
) VALUES (
    'dean-rommel-constantino',
    'Rommel Constantino',
    'rommel.constantino@gradely.edu',
    'dean',
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    'College Dean & Department Head',
    'College of Information and Computing Sciences'
) ON CONFLICT (id) DO NOTHING;
