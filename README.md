# Student Management System - REST API Backend

A production-ready Node.js + Express + TypeScript backend server for the Student Management System (SMS). It integrates securely with Supabase (PostgreSQL) using the server-side Service Role key and exposes protected REST API endpoints authenticated via JWT Bearer tokens.

---

## Features

- **TypeScript & Express**: Clean, type-safe REST API server architecture.
- **Supabase Integration**: Server-to-database communication with PostgreSQL using `@supabase/supabase-js` service role key.
- **JWT Authentication & RBAC**: HttpOnly cookie sessions with legacy Bearer-token compatibility, supporting `dean`, `teacher`, and `student` roles.
- **Encrypted Credential Vault**: Bcrypt password hashes safely isolated inside `grading_matrix_templates` system record (`sys-auth-vault`), filtered out of all public APIs.
- **Batch Sync & Multi-Section Support**: Optimized endpoints for syncing entity mutations with automated parsing and encoding of section IDs and adviser tags.
- **Security & Logging**: Helmet for secure headers, CORS, and Morgan request logging.

---

## Getting Started

### 1. Prerequisites
- Node.js (v18+ recommended)
- npm or yarn

### 2. Installation
Navigate to the `backend` directory and install dependencies:
```bash
cd backend
npm install
```

From the project root, `npm run dev:api` starts the API during frontend development. The frontend expects the API at `http://localhost:3001` by default; if it is not running, the portal will show a connection error.

### 3. Environment Configuration
Copy `.env.example` to `.env` and fill in your Supabase project credentials:
```bash
cp .env.example .env
```

Configure the environment variables in `.env`:
```env
PORT=3001
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=7d
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-supabase-service-role-key
FRONTEND_URL=http://localhost:5173
```

### 4. Running the Server

#### Development Mode (with hot-reload)
```bash
npm run dev
```

#### Production Build & Start
```bash
npm run build
npm start
```

Once started, the backend server will listen at `http://localhost:3001`.

### 5. Swagger API Documentation

Open the interactive API documentation at:

```text
http://localhost:3001/docs/
```

The raw OpenAPI document is available at `http://localhost:3001/docs/openapi.json`. Set `PUBLIC_API_URL` in production so the Swagger “Servers” selector uses the deployed API URL.

---

## Environment Variables

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `PORT` | Port for Express server | `3001` |
| `JWT_SECRET` | Secret key used for signing & verifying JWT tokens | `your-super-secret-jwt-key` |
| `JWT_EXPIRES_IN` | Token expiration timeframe | `7d` |
| `SUPABASE_URL` | Supabase project URL (`https://<project-ref>.supabase.co`) | None (Required) |
| `SUPABASE_SERVICE_KEY` | Supabase Service Role Secret Key (Server-side only) | None (Required) |
| `FRONTEND_URL` | Allowed origin URL for CORS policy | `http://localhost:5173` |

---

## API Endpoints Reference

### Health Check
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | Public | Returns service health status & Supabase connection state |

### Authentication (`/api/auth`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/login` | Public | Authenticates user by email + password; returns JWT token & user object |
| `POST` | `/api/auth/register` | Dean / Initial | Registers a new user and adds hashed password to credentials vault |
| `GET` | `/api/auth/me` | Authenticated | Retrieves current authenticated user's profile |
| `POST` | `/api/auth/change-password` | Authenticated | Updates the password hash in the vault |
| `PUT` | `/api/auth/profile` | Authenticated | Updates user profile fields (name, avatar, title, department) |

### Data Synchronization & Management (`/api/data`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/data/all` | Authenticated | Fetches all data (users, sections, subjects, assessments, scores, attendance, matrix templates, holidays) |
| `POST` | `/api/data/sync` | Authenticated | Batch mutation endpoint (`UPSERT` / `DELETE`) executing in dependency order |
| `POST` | `/api/data/push-all` | Dean Only | Overwrites cloud snapshot with local dataset |
| `DELETE` | `/api/data/wipe` | Dean Only | Wipes cloud data (supports `keepTeachersAndTemplates=true` query param) |

### Student-ID Attendance Tap-In (`/api/attendance`)

| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/attendance/tap` | Teacher / Dean | Finds a student by `studentNumber` and creates or updates attendance for a subject and date |

Example request:

```json
{
  "studentNumber": "250102531",
  "subjectId": "subj-programming-1",
  "date": "2026-10-19",
  "status": "present",
  "period": "prelim",
  "note": "ID card tap-in"
}
```

Send the JWT returned by `/api/auth/login` as:

```http
Authorization: Bearer YOUR_JWT_TOKEN
```

Repeated taps for the same student, subject, and date update the existing record rather than creating duplicates.

### Faculty & Teacher Management (`/api/teachers`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/teachers` | Dean Only | Lists all faculty members (teachers & deans) with password change flags |
| `POST` | `/api/teachers` | Dean Only | Creates a new faculty member with credentials stored in vault |
| `PUT` | `/api/teachers/:id` | Dean Only | Updates faculty profile or resets password |
| `DELETE` | `/api/teachers/:id` | Dean Only | Removes a faculty account and credentials |

---

## Directory Structure

```
backend/
├── .env.example
├── .env
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── index.ts
    ├── lib/
    │   ├── helpers.ts
    │   └── supabase.ts
    ├── middleware/
    │   ├── auth.ts
    │   └── error.ts
    ├── routes/
    │   ├── attendance.routes.ts
    │   ├── auth.routes.ts
    │   ├── data.routes.ts
    │   └── teachers.routes.ts
    ├── docs/
    │   └── openapi.ts
    └── types/
        └── index.ts
```
