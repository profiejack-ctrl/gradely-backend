import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes';
import dataRoutes from './routes/data.routes';
import teachersRoutes from './routes/teachers.routes';
import auditRoutes from './routes/audit.routes';
import { errorHandler } from './middleware/error';
import { isSupabaseConfigured } from './lib/supabase';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Security and utility middleware
app.use(helmet());
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

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
app.use('/api/teachers', teachersRoutes);
app.use('/api/audit', auditRoutes);

// 404 handler for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: `Cannot ${req.method} ${req.url}` });
});

// Centralized error handler
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 SMS Backend running on http://localhost:${PORT}`);
  console.log(`📡 Supabase: ${isSupabaseConfigured ? 'configured' : 'not configured'}`);
});

export default app;
