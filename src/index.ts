import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes';
import dataRoutes from './routes/data.routes';
import teachersRoutes from './routes/teachers.routes';
import auditRoutes from './routes/audit.routes';
import attendanceRoutes from './routes/attendance.routes';
import { errorHandler } from './middleware/error';
import { isSupabaseConfigured } from './lib/supabase';
import swaggerUi from 'swagger-ui-express';
import { openapiDocument } from './docs/openapi';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Collect explicitly configured origins
const configuredOrigins = [process.env.ALLOWED_ORIGINS, process.env.FRONTEND_URL]
  .filter(Boolean)
  .flatMap(value => String(value).split(','))
  .map(origin => origin.trim().replace(/\/+$/, '').toLowerCase())
  .filter(Boolean);

const allowedOriginsSet = new Set(configuredOrigins);
// Default local origins
allowedOriginsSet.add('http://localhost:5173');
allowedOriginsSet.add('http://localhost:3000');
allowedOriginsSet.add('http://127.0.0.1:5173');

function isOriginAllowed(origin?: string): boolean {
  if (!origin) return true; // non-browser requests (Postman, server-to-server)
  const clean = origin.trim().replace(/\/+$/, '').toLowerCase();
  if (allowedOriginsSet.has(clean)) return true;
  // Automatically allow all Vercel deployments (production, preview, staging)
  if (/^https:\/\/[a-z0-9_-]+\.vercel\.app$/.test(clean)) return true;
  // Allow localhost & local network testing
  if (/^http:\/\/localhost(:\d+)?$/.test(clean)) return true;
  if (/^http:\/\/127\.0\.0\.1(:\d+)?$/.test(clean)) return true;
  return false;
}

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      console.warn(`[cors] Rejected origin: ${origin}`);
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Set-Cookie'],
  optionsSuccessStatus: 204,
};

// 1. CORS middleware must run before everything else
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// 2. Helmet with crossOriginResourcePolicy allowing cross-origin API calls
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// API documentation
app.get('/docs/openapi.json', (_req, res) => {
  res.json(openapiDocument);
});
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiDocument, {
  customSiteTitle: 'Gradely API Documentation',
  explorer: true,
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    supabaseConfigured: isSupabaseConfigured,
  });
});

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/teachers', teachersRoutes);
app.use('/api/audit', auditRoutes);

// 404 handler for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: `Cannot ${req.method} ${req.url}` });
});

// Centralized error handler
app.use(errorHandler);

// Start server locally. Vercel invokes the exported Express app.
if (!process.env.VERCEL) app.listen(PORT, () => {
  console.log(`🚀 SMS Backend running on http://localhost:${PORT}`);
  console.log(`📡 Supabase: ${isSupabaseConfigured ? 'configured' : 'not configured'}`);
});

export default app;
