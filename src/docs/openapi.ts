const jsonResponse = (description: string, example: unknown) => ({
  description,
  content: {
    'application/json': { example },
  },
});

export const openapiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Gradely Student Management API',
    version: '1.0.0',
    description:
      'REST API for authentication, student records, gradebook synchronization, and attendance tap-in. Use the student number printed on the student ID with POST /api/attendance/tap.',
  },
  servers: [
    {
      url: process.env.PUBLIC_API_URL || 'http://localhost:3001',
      description: process.env.PUBLIC_API_URL ? 'Configured API server' : 'Local development server',
    },
  ],
  tags: [
    { name: 'Health' },
    { name: 'Authentication' },
    { name: 'Attendance', description: 'Student-ID tap-in attendance operations' },
    { name: 'Data', description: 'Cloud synchronization and data loading' },
    { name: 'Teachers' },
    { name: 'Audit' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT returned by POST /api/auth/login. The web app also supports the gradely_session cookie.',
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
          name: { type: 'string', example: 'Santos, Maria' },
          email: { type: 'string', format: 'email', example: 'maria.santos.250102531@student.gradely.edu' },
          role: { type: 'string', enum: ['student', 'teacher', 'dean'] },
          studentNumber: { type: 'string', nullable: true, example: '250102531' },
          sectionId: { type: 'string', nullable: true, example: 'section-bsit-1a' },
          sectionIds: { type: 'array', items: { type: 'string' } },
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
          subjectId: { type: 'string', description: 'The subject/course receiving attendance.', example: 'subj-programming-1' },
          date: { type: 'string', format: 'date', description: 'Attendance date. Defaults to the server date.', example: '2026-10-19' },
          status: { type: 'string', enum: ['present', 'late', 'absent', 'excused'], default: 'present', example: 'present' },
          period: { type: 'string', enum: ['prelim', 'midterm', 'finals'], default: 'prelim', example: 'prelim' },
          note: { type: 'string', example: 'ID card tap-in' },
        },
      },
      SyncMutation: {
        type: 'object',
        required: ['table', 'action', 'payload'],
        properties: {
          table: { type: 'string', enum: ['users', 'sections', 'subjects', 'assessments', 'score_records', 'attendance_records', 'holidays'] },
          action: { type: 'string', enum: ['UPSERT', 'DELETE'] },
          payload: { type: 'object', additionalProperties: true },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Check API health',
        responses: { '200': jsonResponse('API health status', { status: 'ok', timestamp: '2026-10-19T09:00:00.000Z', supabaseConfigured: true }) },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Authentication'],
        summary: 'Log in with student number/email and password',
        requestBody: {
          required: true,
          content: { 'application/json': { example: { identifier: '250102531', password: '250102531' } } },
        },
        responses: {
          '200': jsonResponse('Authenticated session', { token: 'eyJhbGciOiJIUzI1NiIs...', user: { id: 'stud-abc123', name: 'Santos, Maria', role: 'student', studentNumber: '250102531' } }),
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Authentication'], security: [{ bearerAuth: [] }], summary: 'Get the current authenticated user',
        responses: { '200': jsonResponse('Current user', { user: { id: 'stud-abc123', name: 'Santos, Maria', role: 'student', studentNumber: '250102531' } }), '401': { $ref: '#/components/responses/Unauthorized' } },
      },
    },
    '/api/auth/logout': {
      post: {
        tags: ['Authentication'], summary: 'Log out and clear the session cookie',
        responses: { '200': jsonResponse('Logged out', { success: true }) },
      },
    },
    '/api/attendance/tap': {
      post: {
        tags: ['Attendance'], security: [{ bearerAuth: [] }],
        summary: 'Record attendance using a student ID number',
        description: 'Use this endpoint from the ID-card/tap-in app. Repeating the same student, subject, and date updates the existing attendance record instead of creating a duplicate.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/TapAttendanceRequest' }, example: { studentNumber: '250102531', subjectId: 'subj-programming-1', date: '2026-10-19', status: 'present', period: 'prelim', note: 'ID card tap-in' } } },
        },
        responses: {
          '200': jsonResponse('Attendance updated', { success: true, created: false, student: { id: 'stud-abc123', name: 'Santos, Maria', studentNumber: '250102531' }, attendance: { id: 'att-existing', subjectId: 'subj-programming-1', studentId: 'stud-abc123', date: '2026-10-19', status: 'present', period: 'prelim', note: 'ID card tap-in' } }),
          '201': jsonResponse('Attendance created', { success: true, created: true, student: { id: 'stud-abc123', name: 'Santos, Maria', studentNumber: '250102531' }, attendance: { id: 'att-new', subjectId: 'subj-programming-1', studentId: 'stud-abc123', date: '2026-10-19', status: 'present', period: 'prelim', note: 'ID card tap-in' } }),
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': jsonResponse('Student or subject not found', { error: 'Student number was not found' }),
        },
      },
    },
    '/api/data/all': {
      get: {
        tags: ['Data'], security: [{ bearerAuth: [] }], summary: 'Load all data visible to the current user',
        responses: { '200': jsonResponse('Application data snapshot', { users: [], sections: [], subjects: [], assessments: [], scores: [], attendance: [], matrixTemplates: [], holidays: [] }), '401': { $ref: '#/components/responses/Unauthorized' } },
      },
    },
    '/api/data/sync': {
      post: {
        tags: ['Data'], security: [{ bearerAuth: [] }], summary: 'Synchronize one or more records',
        description: 'The web app uses this endpoint for queued mutations. For a tap-in application, prefer POST /api/attendance/tap because it resolves the student number for you.',
        requestBody: {
          required: true,
          content: { 'application/json': { example: { mutations: [{ table: 'attendance_records', action: 'UPSERT', payload: { id: 'att-device-001', subject_id: 'subj-programming-1', student_id: 'stud-abc123', student_number: '250102531', date: '2026-10-19', status: 'present', period: 'prelim', note: 'ID card tap-in' } }] } } },
        },
        responses: { '200': jsonResponse('Mutations synchronized', { success: true, synced: 1, errors: [] }), '400': { $ref: '#/components/responses/BadRequest' }, '422': jsonResponse('Some mutations failed', { success: false, synced: 0, errors: ['attendance_records UPSERT: ...'] }) },
      },
    },
    '/api/data/push-all': {
      post: {
        tags: ['Data'], security: [{ bearerAuth: [] }], summary: 'Upload a complete local snapshot',
        description: 'Faculty-only operation. Use cautiously; this is intended for full re-sync, not individual tap-ins.',
        requestBody: { required: true, content: { 'application/json': { example: { users: [], sections: [], templates: [], subjects: [], assessments: [], scores: [], attendance: [], holidays: [] } } } },
        responses: { '200': jsonResponse('Snapshot upload result', { success: true, errors: [] }), '403': { $ref: '#/components/responses/Forbidden' } },
      },
    },
    '/api/teachers': {
      get: { tags: ['Teachers'], security: [{ bearerAuth: [] }], summary: 'List teachers and deans', responses: { '200': jsonResponse('Teacher list', []) } },
      post: { tags: ['Teachers'], security: [{ bearerAuth: [] }], summary: 'Create a teacher', requestBody: { required: true, content: { 'application/json': { example: { name: 'Teacher One', email: 'teacher.one@gradely.edu', department: 'CICS', title: 'Instructor', password: 'temporary-password' } } } }, responses: { '201': jsonResponse('Teacher created', { success: true, user: { id: 'teacher-1', name: 'Teacher One', role: 'teacher' } }) } },
    },
    '/api/audit': {
      get: { tags: ['Audit'], security: [{ bearerAuth: [] }], summary: 'Read audit events', parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 100, maximum: 200 } }], responses: { '200': jsonResponse('Audit entries', []) } },
    },
  },
} as const;

// Reusable response references are kept outside the generated path objects so
// the document stays readable while Swagger UI still renders them normally.
(openapiDocument.components as any).responses = {
  Unauthorized: jsonResponse('Authentication required', { error: 'Missing or invalid Authorization header' }),
  Forbidden: jsonResponse('Insufficient permissions', { error: 'Faculty access required' }),
  BadRequest: jsonResponse('Invalid request', { error: 'Invalid attendance status' }),
};
