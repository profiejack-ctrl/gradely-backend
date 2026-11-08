"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openapiDocument = void 0;
const jsonResponse = (description, example) => ({
    description,
    content: {
        'application/json': { example },
    },
});
exports.openapiDocument = {
    openapi: '3.0.3',
    info: {
        title: 'Gradely Student Management API',
        version: '2.0.0',
        description: 'High-performance REST API for authentication, on-demand student & faculty portals, hybrid schedules, gradebook calculation with transmutation, and RFID attendance tap-in.',
    },
    servers: [
        {
            url: process.env.PUBLIC_API_URL || 'http://localhost:3001',
            description: process.env.PUBLIC_API_URL ? 'Configured API server' : 'Local development server',
        },
    ],
    tags: [
        { name: 'Health', description: 'System health check' },
        { name: 'Authentication', description: 'Session management, JWT authentication, and user profile' },
        { name: 'Faculty', description: 'Modular, on-demand teacher portal endpoints (subjects, sections, rosters, gradebook, attendance)' },
        { name: 'Student', description: 'Mobile student portal endpoints (lightweight dashboard, enrolled courses, attendance, grades)' },
        { name: 'Attendance', description: 'RFID / Student-ID tap-in attendance operations' },
        { name: 'Data', description: 'Cloud synchronization, delta-sync, and legacy data exports' },
        { name: 'Teachers', description: 'Dean-only faculty account administration' },
        { name: 'Audit', description: 'System audit trail logs' },
    ],
    components: {
        securitySchemes: {
            bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
                description: 'JWT token returned by POST /api/auth/login. The web client also supports the gradely_session HttpOnly cookie.',
            },
        },
        schemas: {
            Error: {
                type: 'object',
                properties: { error: { type: 'string', example: 'Invalid or expired token' } },
            },
            User: {
                type: 'object',
                properties: {
                    id: { type: 'string', example: 'stud-abc123' },
                    studentId: { type: 'string', example: '250102531' },
                    studentNumber: { type: 'string', nullable: true, example: '250102531' },
                    name: { type: 'string', example: 'Maria Santos' },
                    firstName: { type: 'string', example: 'Maria' },
                    lastName: { type: 'string', example: 'Santos' },
                    email: { type: 'string', format: 'email', example: 'maria.santos@student.gradely.edu' },
                    role: { type: 'string', enum: ['student', 'teacher', 'dean'] },
                    avatar: { type: 'string', example: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330' },
                    profilePicture: { type: 'string', example: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330' },
                    address: { type: 'string', example: '123 Rizal Ave, Sampaloc, Manila' },
                    contactNumber: { type: 'string', example: '+63 912 345 6789' },
                    sectionId: { type: 'string', nullable: true, example: 'section-bsit-1a' },
                    sectionIds: { type: 'array', items: { type: 'string' } },
                },
            },
            ScheduleSession: {
                type: 'object',
                properties: {
                    mode: { type: 'string', enum: ['f2f', 'online'], example: 'f2f' },
                    day: { type: 'string', enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], example: 'Monday' },
                    startTime: { type: 'string', example: '08:00' },
                    endTime: { type: 'string', example: '10:00' },
                    room: { type: 'string', nullable: true, example: 'CL-302' },
                    meetingUrl: { type: 'string', nullable: true, example: 'https://meet.google.com/xyz' },
                },
            },
            AttendanceRecord: {
                type: 'object',
                properties: {
                    id: { type: 'string', example: 'att-mgz8q1-abc12' },
                    subjectId: { type: 'string', example: 'subj-programming-1' },
                    studentId: { type: 'string', example: 'stud-abc123' },
                    date: { type: 'string', format: 'date', example: '2026-10-19' },
                    period: { type: 'string', enum: ['prelim', 'midterm', 'finals'], example: 'prelim' },
                    status: { type: 'string', enum: ['present', 'late', 'absent', 'excused'], example: 'present' },
                    note: { type: 'string', nullable: true, example: 'ID card tap-in' },
                },
            },
            TapAttendanceRequest: {
                type: 'object',
                required: ['studentNumber', 'subjectId'],
                properties: {
                    studentNumber: { type: 'string', description: 'Student number read from the ID card.', example: '250102531' },
                    subjectId: { type: 'string', description: 'The subject receiving attendance.', example: 'subj-programming-1' },
                    date: { type: 'string', format: 'date', description: 'Attendance date (YYYY-MM-DD). Defaults to server date.', example: '2026-10-19' },
                    status: { type: 'string', enum: ['present', 'late', 'absent', 'excused'], default: 'present', example: 'present' },
                    period: { type: 'string', enum: ['prelim', 'midterm', 'finals'], default: 'prelim', example: 'prelim' },
                    note: { type: 'string', example: 'ID card tap-in' },
                },
            },
        },
    },
    paths: {
        // =========================================================================
        // HEALTH
        // =========================================================================
        '/health': {
            get: {
                tags: ['Health'],
                summary: 'Check API service health',
                responses: {
                    '200': jsonResponse('API health status', {
                        status: 'ok',
                        timestamp: '2026-10-28T07:00:00.000Z',
                        supabaseConfigured: true,
                    }),
                },
            },
        },
        // =========================================================================
        // AUTHENTICATION
        // =========================================================================
        '/api/auth/login': {
            post: {
                tags: ['Authentication'],
                summary: 'Log in with student number, email, or user ID',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            example: { identifier: 'rommel.constantino@gradely.edu', password: 'password123' },
                        },
                    },
                },
                responses: {
                    '200': jsonResponse('Authenticated session with JWT token', {
                        token: 'eyJhbGciOiJIUzI1NiIs...',
                        user: {
                            id: 'dean-rommel-constantino',
                            name: 'Rommel Constantino',
                            role: 'dean',
                            email: 'rommel.constantino@gradely.edu',
                        },
                    }),
                    '401': { $ref: '#/components/responses/Unauthorized' },
                },
            },
        },
        '/api/auth/register': {
            post: {
                tags: ['Authentication'],
                security: [{ bearerAuth: [] }],
                summary: 'Register a new user (Dean only, or first initial setup)',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            example: {
                                name: 'Maria Santos',
                                email: 'maria.santos@student.gradely.edu',
                                password: 'password123',
                                role: 'student',
                                studentNumber: '250102531',
                                sectionId: 'sec-bsit-1a',
                            },
                        },
                    },
                },
                responses: {
                    '201': jsonResponse('User created', {
                        user: { id: 'usr-123', name: 'Maria Santos', email: 'maria.santos@student.gradely.edu', role: 'student' },
                        token: 'eyJhbGciOiJIUzI1NiIs...',
                    }),
                    '400': { $ref: '#/components/responses/BadRequest' },
                    '403': { $ref: '#/components/responses/Forbidden' },
                },
            },
        },
        '/api/auth/me': {
            get: {
                tags: ['Authentication'],
                security: [{ bearerAuth: [] }],
                summary: 'Get current authenticated user profile',
                responses: {
                    '200': jsonResponse('Current user profile', {
                        id: 'usr-1',
                        name: 'Prof. Rommel Constantino',
                        email: 'rommel.constantino@gradely.edu',
                        role: 'teacher',
                        department: 'CICS',
                    }),
                    '401': { $ref: '#/components/responses/Unauthorized' },
                },
            },
        },
        '/api/auth/logout': {
            post: {
                tags: ['Authentication'],
                summary: 'Log out and clear session cookie',
                responses: {
                    '200': jsonResponse('Logged out successfully', { success: true }),
                },
            },
        },
        // =========================================================================
        // FACULTY (ON-DEMAND & MODULAR)
        // =========================================================================
        '/api/faculty/overview': {
            get: {
                tags: ['Faculty'],
                security: [{ bearerAuth: [] }],
                summary: 'Load teacher dashboard overview & today classes',
                description: 'Lightweight overview (<2KB) showing stats and classes scheduled for the current day of the week.',
                responses: {
                    '200': jsonResponse('Teacher dashboard overview', {
                        teacher: { id: 'usr-1', name: 'Prof. Rommel Constantino', role: 'teacher' },
                        stats: { totalSubjects: 4, totalSections: 2, currentDay: 'Wednesday' },
                        todayClasses: [
                            {
                                subjectCode: 'CS-301',
                                subjectName: 'Data Structures',
                                sectionName: 'BSIT 3-A',
                                mode: 'f2f',
                                startTime: '08:00',
                                endTime: '10:00',
                                room: 'CL-302',
                            },
                        ],
                        recentAssessments: [],
                    }),
                    '401': { $ref: '#/components/responses/Unauthorized' },
                    '403': { $ref: '#/components/responses/Forbidden' },
                },
            },
        },
        '/api/faculty/subjects': {
            get: {
                tags: ['Faculty'],
                security: [{ bearerAuth: [] }],
                summary: 'List subjects assigned to the logged-in teacher',
                description: 'Returns only assigned courses with structured hybrid schedules, units, and section names.',
                responses: {
                    '200': jsonResponse('Assigned subject list', [
                        {
                            id: 'subj-cs301',
                            sectionId: 'sec-bsit-3a',
                            sectionName: 'BSIT 3-A',
                            name: 'Data Structures & Algorithms',
                            code: 'CS-301',
                            units: 3,
                            passingGrade: 75,
                            gradeDisplayMode: 'both',
                            templateName: 'Standard University Matrix',
                            schedule: [
                                { mode: 'f2f', day: 'Monday', startTime: '08:00', endTime: '10:00', room: 'CL-302' },
                                { mode: 'online', day: 'Thursday', startTime: '08:00', endTime: '10:00', meetingUrl: 'https://meet.google.com/xyz' },
                            ],
                        },
                    ]),
                },
            },
        },
        '/api/faculty/subjects/{subjectId}': {
            get: {
                tags: ['Faculty'],
                security: [{ bearerAuth: [] }],
                summary: 'Get single subject details with grading matrix',
                parameters: [{ name: 'subjectId', in: 'path', required: true, schema: { type: 'string' }, example: 'subj-cs301' }],
                responses: {
                    '200': jsonResponse('Subject detail', {
                        id: 'subj-cs301',
                        name: 'Data Structures & Algorithms',
                        code: 'CS-301',
                        units: 3,
                        passingGrade: 75,
                        gradeDisplayMode: 'both',
                        templateName: 'Standard University Matrix',
                        matrix: [
                            { id: 'attendance', name: 'Attendance & Class Participation', weight: 10, isAttendance: true },
                            { id: 'written_works', name: 'Quizzes & Written Works', weight: 25 },
                            { id: 'performance_tasks', name: 'Laboratory & Performance Tasks', weight: 35 },
                            { id: 'major_exam', name: 'Periodical Examination', weight: 30 },
                        ],
                        schedule: [],
                    }),
                    '404': jsonResponse('Subject not found', { error: 'Subject not found or not assigned to you' }),
                },
            },
        },
        '/api/faculty/sections': {
            get: {
                tags: ['Faculty'],
                security: [{ bearerAuth: [] }],
                summary: 'List sections taught or advised by the teacher',
                responses: {
                    '200': jsonResponse('Sections list', [
                        { id: 'sec-bsit-1a', name: 'BSIT 1-A', gradeLevelOrYear: '1st Year', academicYear: '2026-2027', semester: '1st Semester', isAdviser: true },
                        { id: 'sec-bsit-3a', name: 'BSIT 3-A', gradeLevelOrYear: '3rd Year', academicYear: '2026-2027', semester: '1st Semester', isAdviser: false },
                    ]),
                },
            },
        },
        '/api/faculty/sections/{sectionId}/students': {
            get: {
                tags: ['Faculty'],
                security: [{ bearerAuth: [] }],
                summary: 'Lazy-load student roster strictly for one section',
                description: 'When opening a section, only the enrolled students for that section are fetched (~5KB), eliminating monolithic downloads.',
                parameters: [{ name: 'sectionId', in: 'path', required: true, schema: { type: 'string' }, example: 'sec-bsit-1a' }],
                responses: {
                    '200': jsonResponse('Section student roster', {
                        section: { id: 'sec-bsit-1a', name: 'BSIT 1-A', gradeLevelOrYear: '1st Year' },
                        count: 32,
                        students: [
                            { id: 'stud-1', name: 'Santos, Maria', studentNumber: '250102531', email: 'maria.santos@student.gradely.edu', avatar: 'https://...' },
                        ],
                    }),
                    '403': jsonResponse('Forbidden', { error: 'You are not assigned to teach or advise this section' }),
                },
            },
        },
        '/api/faculty/subjects/{subjectId}/gradebook': {
            get: {
                tags: ['Faculty'],
                security: [{ bearerAuth: [] }],
                summary: 'Lazy-load gradebook matrix for one subject',
                description: 'Fetches enrolled section students, assessments for the period, and scores with calculated raw and transmuted values.',
                parameters: [
                    { name: 'subjectId', in: 'path', required: true, schema: { type: 'string' }, example: 'subj-cs301' },
                    { name: 'period', in: 'query', required: false, schema: { type: 'string', enum: ['prelim', 'midterm', 'finals'] }, example: 'prelim' },
                ],
                responses: {
                    '200': jsonResponse('Class gradebook', {
                        subject: { id: 'subj-cs301', name: 'Data Structures', code: 'CS-301', sectionName: 'BSIT 3-A', passingGrade: 75, gradeDisplayMode: 'both' },
                        period: 'prelim',
                        assessments: [{ id: 'ass-1', title: 'Quiz 1', maxScore: 50, date: '2026-10-20' }],
                        gradebook: [
                            {
                                student: { id: 'stud-1', name: 'Santos, Maria', studentNumber: '250102531' },
                                scores: {
                                    'ass-1': { rawScore: 45, maxScore: 50, rawPercent: 90.0, transmutedGrade: 95.0, remarks: 'Good job' },
                                },
                            },
                        ],
                    }),
                },
            },
        },
        '/api/faculty/subjects/{subjectId}/attendance': {
            get: {
                tags: ['Faculty'],
                security: [{ bearerAuth: [] }],
                summary: 'Load attendance records for one subject',
                parameters: [
                    { name: 'subjectId', in: 'path', required: true, schema: { type: 'string' }, example: 'subj-cs301' },
                    { name: 'date', in: 'query', required: false, schema: { type: 'string', format: 'date' }, example: '2026-10-28' },
                    { name: 'period', in: 'query', required: false, schema: { type: 'string', enum: ['prelim', 'midterm', 'finals'] }, example: 'prelim' },
                ],
                responses: {
                    '200': jsonResponse('Subject attendance', {
                        subject: { id: 'subj-cs301', code: 'CS-301', name: 'Data Structures' },
                        filters: { date: '2026-10-28', period: 'prelim' },
                        metrics: { total: 32, present: 30, late: 2, absent: 0, attendancePercent: 96.9 },
                        records: [],
                    }),
                },
            },
        },
        '/api/faculty/matrix-templates': {
            get: {
                tags: ['Faculty'],
                security: [{ bearerAuth: [] }],
                summary: 'List available department grading matrix templates',
                responses: {
                    '200': jsonResponse('Grading matrix templates', [
                        {
                            id: 'tmpl-college-standard',
                            name: 'Standard College Lecture with Laboratory',
                            passingGrade: 75,
                            gradeDisplayMode: 'both',
                            matrix: [],
                        },
                    ]),
                },
            },
        },
        '/api/faculty/students': {
            get: {
                tags: ['Faculty'],
                security: [{ bearerAuth: [] }],
                summary: 'Paginated student directory with search',
                description: 'Returns only 25-50 students per page rather than thousands at once. Supports search by name, student number, or email, and section filtering.',
                parameters: [
                    { name: 'page', in: 'query', schema: { type: 'integer', default: 1 }, example: 1 },
                    { name: 'limit', in: 'query', schema: { type: 'integer', default: 25, maximum: 100 }, example: 25 },
                    { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Filter by student name, number, or email', example: 'santos' },
                    { name: 'sectionId', in: 'query', schema: { type: 'string' }, description: 'Filter by section ID', example: 'sec-bsit-1a' },
                ],
                responses: {
                    '200': jsonResponse('Paginated student directory', {
                        data: [
                            { id: 'stud-1', name: 'Santos, Maria', studentNumber: '250102531', email: 'maria.santos@student.gradely.edu', sectionIds: ['sec-bsit-1a'] },
                        ],
                        meta: { page: 1, limit: 25, total: 3450, totalPages: 138, hasNext: true, hasPrev: false },
                    }),
                },
            },
        },
        '/api/faculty/assessments': {
            get: {
                tags: ['Faculty'],
                security: [{ bearerAuth: [] }],
                summary: 'Paginated assessments list for a subject',
                parameters: [
                    { name: 'subjectId', in: 'query', required: true, schema: { type: 'string' }, example: 'subj-cs301' },
                    { name: 'period', in: 'query', schema: { type: 'string', enum: ['prelim', 'midterm', 'finals'] }, example: 'prelim' },
                    { name: 'page', in: 'query', schema: { type: 'integer', default: 1 }, example: 1 },
                    { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 }, example: 20 },
                ],
                responses: {
                    '200': jsonResponse('Paginated assessments', {
                        subject: { id: 'subj-cs301', code: 'CS-301', name: 'Data Structures' },
                        data: [{ id: 'ass-1', title: 'Quiz 1', maxScore: 50, period: 'prelim', date: '2026-10-20' }],
                        meta: { page: 1, limit: 20, total: 15, totalPages: 1, hasNext: false, hasPrev: false },
                    }),
                },
            },
        },
        '/api/faculty/assessments/{assessmentId}/scores': {
            get: {
                tags: ['Faculty'],
                security: [{ bearerAuth: [] }],
                summary: 'On-demand scores for a single assessment',
                description: 'Targeted score-entry view: Fetches only the section students and their scores for this specific assessment, avoiding full gradebook matrix downloads.',
                parameters: [
                    { name: 'assessmentId', in: 'path', required: true, schema: { type: 'string' }, example: 'ass-1' },
                ],
                responses: {
                    '200': jsonResponse('Assessment score roster', {
                        assessment: { id: 'ass-1', title: 'Quiz 1', maxScore: 50, period: 'prelim', subjectCode: 'CS-301' },
                        totalStudents: 32,
                        gradedCount: 30,
                        scores: [
                            {
                                student: { id: 'stud-1', name: 'Santos, Maria', studentNumber: '250102531' },
                                rawScore: 45,
                                maxScore: 50,
                                rawPercent: 90.0,
                                transmutedGrade: 95.0,
                            },
                        ],
                    }),
                },
            },
        },
        // =========================================================================
        // STUDENT PORTAL (MOBILE-FRIENDLY)
        // =========================================================================
        '/api/student/dashboard': {
            get: {
                tags: ['Student'],
                security: [{ bearerAuth: [] }],
                summary: 'Mobile student dashboard overview',
                description: 'Lightweight overview screen (<5KB) providing today schedule, overall attendance rate %, and recent assessment statuses.',
                responses: {
                    '200': jsonResponse('Student dashboard', {
                        student: { id: 'stud-1', name: 'Santos, Maria', studentNumber: '250102531' },
                        overview: { enrolledSubjectsCount: 5, totalUnits: 18, overallAttendanceRate: 95.5, currentDay: 'Wednesday' },
                        todaySchedule: [
                            { subjectCode: 'CS-301', subjectName: 'Data Structures', mode: 'f2f', startTime: '08:00', endTime: '10:00', room: 'CL-302' },
                        ],
                        recentAssessments: [],
                        subjects: [],
                    }),
                    '403': { $ref: '#/components/responses/StudentOnly' },
                },
            },
        },
        '/api/student/subjects': {
            get: {
                tags: ['Student'],
                security: [{ bearerAuth: [] }],
                summary: 'List student enrolled subjects with hybrid schedules',
                responses: {
                    '200': jsonResponse('Enrolled subjects', {
                        sections: [{ id: 'sec-bsit-3a', name: 'BSIT 3-A' }],
                        subjects: [
                            {
                                id: 'subj-cs301',
                                code: 'CS-301',
                                name: 'Data Structures',
                                units: 3,
                                passingGrade: 75,
                                gradeDisplayMode: 'both',
                                schedule: [
                                    { mode: 'f2f', day: 'Monday', startTime: '08:00', endTime: '10:00', room: 'CL-302' },
                                    { mode: 'online', day: 'Thursday', startTime: '08:00', endTime: '10:00', meetingUrl: 'https://meet.google.com/xyz' },
                                ],
                                teacher: { id: 'usr-1', name: 'Prof. Constantino' },
                            },
                        ],
                    }),
                    '403': { $ref: '#/components/responses/StudentOnly' },
                },
            },
        },
        '/api/student/subjects/{subjectId}': {
            get: {
                tags: ['Student'],
                security: [{ bearerAuth: [] }],
                summary: 'Load single subject syllabus, assessments & grades',
                description: 'Includes auto-synthesized Attendance Assessment calculated from tap-in logs, and both raw and transmuted grade calculations.',
                parameters: [{ name: 'subjectId', in: 'path', required: true, schema: { type: 'string' }, example: 'subj-cs301' }],
                responses: {
                    '200': jsonResponse('Subject progress detail', {
                        student: { id: 'stud-1', name: 'Santos, Maria' },
                        subject: { id: 'subj-cs301', code: 'CS-301', name: 'Data Structures' },
                        periods: {
                            prelim: {
                                period: 'prelim',
                                gradeDisplayMode: 'both',
                                rawGrade: 88.5,
                                transmutedGrade: 94.2,
                                isPassing: true,
                                categories: [],
                                assessments: [],
                            },
                        },
                        rawAttendanceRecords: [],
                    }),
                    '403': { $ref: '#/components/responses/StudentOnly' },
                    '404': jsonResponse('Subject not found', { error: 'Subject not found or not enrolled' }),
                },
            },
        },
        '/api/student/attendance': {
            get: {
                tags: ['Student'],
                security: [{ bearerAuth: [] }],
                summary: 'List student attendance tap-in records',
                parameters: [{ name: 'subjectId', in: 'query', required: false, schema: { type: 'string' } }],
                responses: {
                    '200': jsonResponse('Student attendance records', {
                        summary: { total: 20, present: 18, late: 2, absent: 0, attendancePercent: 95.0 },
                        attendance: [],
                    }),
                    '403': { $ref: '#/components/responses/StudentOnly' },
                },
            },
        },
        '/api/student/profile': {
            get: {
                tags: ['Student'],
                security: [{ bearerAuth: [] }],
                summary: 'Get complete student profile and section enrollments',
                description: 'Returns complete student profile data: studentId, firstName, lastName, email, address, contactNumber, avatar, profilePicture, and section enrollments.',
                responses: {
                    '200': jsonResponse('Student profile', {
                        student: {
                            id: 'stud-1',
                            studentId: '250102531',
                            studentNumber: '250102531',
                            name: 'Maria Santos',
                            firstName: 'Maria',
                            lastName: 'Santos',
                            email: 'maria.santos@student.gradely.edu',
                            address: '123 Rizal Ave, Sampaloc, Manila',
                            contactNumber: '+63 912 345 6789',
                            avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330',
                            profilePicture: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330',
                            role: 'student',
                            sectionIds: ['section-bsit-1a'],
                        },
                        sections: [],
                    }),
                    '403': { $ref: '#/components/responses/StudentOnly' },
                },
            },
            put: {
                tags: ['Student'],
                security: [{ bearerAuth: [] }],
                summary: 'Customize / update student profile from mobile app',
                description: 'Allows the student to customize their profile picture (URL or base64 data URI), name, address, contact number, and optionally change password.',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            example: {
                                firstName: 'Maria',
                                lastName: 'Santos',
                                address: '123 Rizal Ave, Sampaloc, Manila',
                                contactNumber: '+63 912 345 6789',
                                profilePicture: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330',
                                newPassword: 'optionalNewPassword123',
                            },
                        },
                    },
                },
                responses: {
                    '200': jsonResponse('Profile updated successfully', {
                        success: true,
                        message: 'Profile updated successfully',
                        student: {
                            id: 'stud-1',
                            studentId: '250102531',
                            studentNumber: '250102531',
                            name: 'Maria Santos',
                            firstName: 'Maria',
                            lastName: 'Santos',
                            email: 'maria.santos@student.gradely.edu',
                            address: '123 Rizal Ave, Sampaloc, Manila',
                            contactNumber: '+63 912 345 6789',
                            avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330',
                            profilePicture: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330',
                            role: 'student',
                            sectionIds: ['section-bsit-1a'],
                        },
                        sections: [],
                    }),
                    '400': { $ref: '#/components/responses/BadRequest' },
                    '403': { $ref: '#/components/responses/StudentOnly' },
                },
            },
        },
        // =========================================================================
        // ATTENDANCE TAP-IN
        // =========================================================================
        '/api/attendance/tap': {
            post: {
                tags: ['Attendance'],
                security: [{ bearerAuth: [] }],
                summary: 'Record attendance using student ID number (RFID / Scanner)',
                description: 'Used by the tap-in kiosk. Idempotently creates or updates attendance for that student, subject, and date.',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/TapAttendanceRequest' },
                            example: {
                                studentNumber: '250102531',
                                subjectId: 'subj-cs301',
                                date: '2026-10-28',
                                status: 'present',
                                period: 'prelim',
                                note: 'RFID tap-in',
                            },
                        },
                    },
                },
                responses: {
                    '200': jsonResponse('Attendance updated', { success: true, created: false }),
                    '201': jsonResponse('Attendance recorded', { success: true, created: true }),
                    '400': { $ref: '#/components/responses/BadRequest' },
                    '403': { $ref: '#/components/responses/Forbidden' },
                    '404': jsonResponse('Student or subject not found', { error: 'Student number was not found' }),
                },
            },
        },
        // =========================================================================
        // DATA SYNCHRONIZATION (WITH GZIP & DELTA-SYNC)
        // =========================================================================
        '/api/data/all': {
            get: {
                tags: ['Data'],
                security: [{ bearerAuth: [] }],
                summary: 'Synchronize application snapshot (Optimized with Delta-Sync & Gzip)',
                parameters: [
                    { name: 'since', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Delta-sync: only return records modified since this timestamp' },
                    { name: 'period', in: 'query', schema: { type: 'string', enum: ['prelim', 'midterm', 'finals'] }, description: 'Filter assessments, scores, and attendance by grading period' },
                    { name: 'subjectId', in: 'query', schema: { type: 'string' }, description: 'Scope snapshot to one subject' },
                    { name: 'sectionId', in: 'query', schema: { type: 'string' }, description: 'Scope snapshot to one section' },
                    { name: 'exclude', in: 'query', schema: { type: 'string' }, description: 'Comma-separated tables to skip (e.g. exclude=attendance,scores)' },
                ],
                responses: {
                    '200': jsonResponse('Optimized data snapshot', {
                        users: [],
                        sections: [],
                        subjects: [],
                        assessments: [],
                        scores: [],
                        attendance: [],
                        matrixTemplates: [],
                        holidays: [],
                    }),
                },
            },
        },
        '/api/data/sync': {
            post: {
                tags: ['Data'],
                security: [{ bearerAuth: [] }],
                summary: 'Batch sync mutations (UPSERT / DELETE)',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            example: {
                                mutations: [
                                    {
                                        table: 'assessments',
                                        action: 'UPSERT',
                                        payload: { id: 'ass-new', subject_id: 'subj-cs301', title: 'Lab 1', max_score: 50, date: '2026-10-28', period: 'prelim' },
                                    },
                                ],
                            },
                        },
                    },
                },
                responses: {
                    '200': jsonResponse('Mutations synced', { success: true, synced: 1, errors: [] }),
                    '400': { $ref: '#/components/responses/BadRequest' },
                },
            },
        },
        // =========================================================================
        // TEACHERS MANAGEMENT
        // =========================================================================
        '/api/teachers': {
            get: {
                tags: ['Teachers'],
                security: [{ bearerAuth: [] }],
                summary: 'List faculty members (Dean only)',
                responses: { '200': jsonResponse('Faculty list', []) },
            },
            post: {
                tags: ['Teachers'],
                security: [{ bearerAuth: [] }],
                summary: 'Create faculty account (Dean only)',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            example: { name: 'Prof. John Doe', email: 'john.doe@gradely.edu', department: 'CICS', title: 'Instructor', password: 'temporaryPassword123' },
                        },
                    },
                },
                responses: { '201': jsonResponse('Faculty created', { success: true }) },
            },
        },
        // =========================================================================
        // AUDIT LOGS
        // =========================================================================
        '/api/audit': {
            get: {
                tags: ['Audit'],
                security: [{ bearerAuth: [] }],
                summary: 'Read system audit trail (Dean only)',
                parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 100, maximum: 200 } }],
                responses: { '200': jsonResponse('Audit events', []) },
            },
        },
    },
};
exports.openapiDocument.components.responses = {
    Unauthorized: jsonResponse('Authentication required', { error: 'Missing or invalid Authorization header' }),
    Forbidden: jsonResponse('Insufficient permissions', { error: 'Faculty or Dean access required' }),
    StudentOnly: jsonResponse('Student access required', { error: 'Student access required' }),
    BadRequest: jsonResponse('Invalid request payload', { error: 'Invalid parameters provided' }),
};
