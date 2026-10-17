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
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      res.status(503).json({ error: 'Authentication service is not configured' });
      return;
    }
    const decoded = jwt.verify(token, secret) as AuthPayload;
    const { data: user, error } = await supabase
      .from('users')
      .select('id,email,name,role')
      .eq('id', decoded.userId)
      .maybeSingle();

    if (error || !user) {
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
  } catch {
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
