import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthPayload } from '../types';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

export interface AuthRequest extends Request {
  user?: AuthPayload;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!isSupabaseConfigured || !supabase) {
    res.status(503).json({ error: 'Authentication service is not configured' });
    return;
  }

  const authHeader = req.headers.authorization;
  const cookieToken = req.headers.cookie
    ?.split(';')
    .map(part => part.trim())
    .find(part => part.startsWith('gradely_session='))
    ?.slice('gradely_session='.length);
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : cookieToken;
  if (!token) {
    console.warn(`[auth] 401 Unauthorized: Missing Authorization header on ${req.method} ${req.originalUrl || req.path}`);
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }
  try {
    const secret = process.env.JWT_SECRET || 'fallback-secret';
    const decoded = jwt.verify(token, secret) as AuthPayload;
    const { data: user, error } = await supabase
      .from('users')
      .select('id,email,name,role')
      .eq('id', decoded.userId)
      .maybeSingle();

    if (error) {
      console.error(`[auth] Supabase database error looking up user ${decoded.userId}:`, error.message);
      res.status(500).json({ error: 'Database error validating session' });
      return;
    }

    if (!user) {
      console.warn(`[auth] 401 Unauthorized: User ${decoded.userId} no longer exists in database`);
      res.status(401).json({ error: 'User account is no longer active' });
      return;
    }

    req.user = {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
    next();
  } catch (err: any) {
    console.warn(`[auth] 401 Unauthorized: Token verification failed on ${req.method} ${req.originalUrl || req.path}:`, err?.message || err);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireDean(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user || (req.user.role !== 'dean')) {
    res.status(403).json({ error: 'Dean access required' });
    return;
  }
  next();
}

export function requireFaculty(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user || (req.user.role !== 'dean' && req.user.role !== 'teacher')) {
    res.status(403).json({ error: 'Faculty access required' });
    return;
  }
  next();
}

/** Restrict a route to the authenticated student's own account. */
export function requireStudent(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'student') {
    res.status(403).json({ error: 'Student access required' });
    return;
  }
  next();
}
