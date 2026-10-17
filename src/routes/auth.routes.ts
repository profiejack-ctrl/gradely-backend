import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { getVault, saveVault } from '../lib/authVault';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { UserRole } from '../types';
import { generateId, parseSectionIds } from '../lib/helpers';

const router = Router();

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT = 10;

function setSessionCookie(res: Response, token: string): void {
  res.cookie('gradely_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 2 * 60 * 60 * 1000,
    path: '/',
  });
}

// ---------------------------------------------------------------------------
// Vault helpers
// ---------------------------------------------------------------------------
function signToken(payload: { userId: string; email: string; role: UserRole; name: string }): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');
  const expiresIn = (process.env.JWT_EXPIRES_IN || '2h') as jwt.SignOptions['expiresIn'];
  return jwt.sign(payload, secret, { expiresIn });
}

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const attempt = loginAttempts.get(key);
  if (attempt && attempt.resetAt > now && attempt.count >= LOGIN_LIMIT) {
    res.status(429).json({ error: 'Too many login attempts. Try again later.' });
    return;
  }
  if (!attempt || attempt.resetAt <= now) loginAttempts.set(key, { count: 0, resetAt: now + LOGIN_WINDOW_MS });
  loginAttempts.get(key)!.count += 1;

  const { email, password } = req.body as { email: string; password?: string };
  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  if (!isSupabaseConfigured || !supabase) {
    res.status(503).json({ error: 'Database not configured on server' });
    return;
  }

  try {
    // 1. Find user
    const { data: userData, error: userErr } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (userErr || !userData) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    // 2. Check vault for password
    const vault = await getVault();
    const entry = vault.find(v => v.email.toLowerCase() === email.toLowerCase().trim());

    if (entry) {
      const valid = await bcrypt.compare(password, entry.passwordHash);
      if (!valid) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }
    } else {
      res.status(401).json({ error: 'Account credentials have not been provisioned' });
      return;
    }

    const sectionIds = userData.section_id ? userData.section_id.split(',').map((s: string) => s.trim()).filter(Boolean) : [];

    const user = {
      id: userData.id,
      name: userData.name,
      email: userData.email,
      role: userData.role as UserRole,
      avatar: userData.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(userData.name)}`,
      studentNumber: userData.student_number || undefined,
      sectionId: sectionIds[0] || undefined,
      sectionIds,
      title: userData.title || undefined,
      department: userData.department || undefined,
      mustChangePassword: entry?.mustChange ?? false,
    };

    const token = signToken({ userId: user.id, email: user.email, role: user.role, name: user.name });
    loginAttempts.delete(key);
    setSessionCookie(res, token);
    res.json({ token, user });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// POST /api/auth/register (Dean-only or initial setup when no users exist)
router.post('/register', async (req: Request, res: Response) => {
  if (!isSupabaseConfigured || !supabase) {
    res.status(503).json({ error: 'Database not configured on server' });
    return;
  }

  const { name, email, password, role = 'teacher', studentNumber, sectionId, title, department } = req.body;
  if (!name || !email || !password || typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Name, email, and password are required' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }
  if (!['dean', 'teacher', 'student'].includes(role)) {
    res.status(400).json({ error: 'Invalid role' });
    return;
  }

  try {
    // Check if any users exist
    const { count } = await supabase.from('users').select('*', { count: 'exact', head: true });
    const isFirstUser = count === 0;

    // If not first user, require dean auth
    if (!isFirstUser) {
      const authHeader = req.headers.authorization;
      const cookieToken = req.headers.cookie
        ?.split(';')
        .map(part => part.trim())
        .find(part => part.startsWith('gradely_session='))
        ?.slice('gradely_session='.length);
      const registrationToken = authHeader?.startsWith('Bearer ')
        ? authHeader.slice(7)
        : cookieToken;
      if (!registrationToken) {
        res.status(401).json({ error: 'Authorization required for registration' });
        return;
      }
      try {
        const secret = process.env.JWT_SECRET;
        if (!secret) throw new Error('JWT_SECRET is not configured');
        const decoded = jwt.verify(registrationToken, secret) as { role: string };
        if (decoded.role !== 'dean') {
          res.status(403).json({ error: 'Dean access required to register new users' });
          return;
        }
      } catch {
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
      }
    }

    // Check if email already registered
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (existingUser) {
      res.status(409).json({ error: 'User with this email already exists' });
      return;
    }

    const assignedRole: UserRole = isFirstUser ? 'dean' : role;
    const userId = generateId('usr');
    const avatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name.trim())}`;

    // Insert user record
    const { error: insertErr } = await supabase.from('users').insert({
      id: userId,
      name: name.trim(),
      email: email.toLowerCase().trim(),
      role: assignedRole,
      avatar,
      student_number: studentNumber || null,
      section_id: sectionId || null,
      title: title || null,
      department: department || null,
    });

    if (insertErr) {
      res.status(500).json({ error: `Failed to create user: ${insertErr.message}` });
      return;
    }

    // Save to auth vault
    const passwordHash = await bcrypt.hash(password, 10);
    const vault = await getVault();
    vault.push({
      userId,
      email: email.toLowerCase().trim(),
      passwordHash,
      mustChange: !isFirstUser,
    });
    await saveVault(vault);

    const newUser = {
      id: userId,
      name: name.trim(),
      email: email.toLowerCase().trim(),
      role: assignedRole,
      avatar,
      studentNumber: studentNumber || undefined,
      sectionId: sectionId || undefined,
      sectionIds: sectionId ? parseSectionIds(sectionId) : [],
      title: title || undefined,
      department: department || undefined,
      mustChangePassword: !isFirstUser,
    };

    const token = signToken({ userId: newUser.id, email: newUser.email, role: newUser.role, name: newUser.name });
    setSessionCookie(res, token);
    res.status(201).json({ user: newUser, token });
  } catch (err: any) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  if (!supabase || !req.user) {
    res.status(503).json({ error: 'Service unavailable' });
    return;
  }
  try {
    const { data, error } = await supabase.from('users').select('*').eq('id', req.user.userId).single();
    if (error || !data) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const sectionIds = data.section_id ? data.section_id.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
    res.json({
      id: data.id, name: data.name, email: data.email, role: data.role,
      avatar: data.avatar, studentNumber: data.student_number || undefined,
      sectionId: sectionIds[0] || undefined, sectionIds,
      title: data.title || undefined, department: data.department || undefined,
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', requireAuth, async (req: AuthRequest, res: Response) => {
  const { newPassword } = req.body as { newPassword: string };
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }
  try {
    const vault = await getVault();
    const hash = await bcrypt.hash(newPassword, 10);
    const existing = vault.findIndex(v => v.userId === req.user!.userId);
    if (existing >= 0) {
      vault[existing].passwordHash = hash;
      vault[existing].mustChange = false;
    } else {
      vault.push({ userId: req.user!.userId, email: req.user!.email, passwordHash: hash, mustChange: false });
    }
    await saveVault(vault);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update password' });
  }
});

router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie('gradely_session', { httpOnly: true, sameSite: 'lax', path: '/' });
  res.json({ success: true });
});

// POST /api/auth/verify-password
router.post('/verify-password', requireAuth, async (req: AuthRequest, res: Response) => {
  const { password } = req.body as { password: string };
  if (!password || typeof password !== 'string') {
    res.status(400).json({ error: 'Password is required' });
    return;
  }
  try {
    const vault = await getVault();
    const entry = vault.find(v => v.userId === req.user!.userId);
    const valid = Boolean(entry && await bcrypt.compare(password, entry.passwordHash));
    res.json({ valid });
  } catch {
    res.status(500).json({ error: 'Failed to verify password' });
  }
});

// PUT /api/auth/profile
router.put('/profile', requireAuth, async (req: AuthRequest, res: Response) => {
  if (!supabase || !req.user) { res.status(503).json({ error: 'Service unavailable' }); return; }
  const { name, avatar, title, department, newPassword } = req.body;
  try {
    const updates: any = {};
    if (name) updates.name = name.trim();
    if (avatar !== undefined) updates.avatar = avatar;
    if (title !== undefined) updates.title = title;
    if (department !== undefined) updates.department = department;

    if (Object.keys(updates).length > 0) {
      const { error } = await supabase.from('users').update(updates).eq('id', req.user.userId);
      if (error) {
        res.status(400).json({ error: error.message });
        return;
      }
    }

    if (newPassword) {
      if (typeof newPassword !== 'string' || newPassword.length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters' });
        return;
      }
      const vault = await getVault();
      const hash = await bcrypt.hash(newPassword, 10);
      const idx = vault.findIndex(v => v.userId === req.user!.userId);
      if (idx >= 0) { vault[idx].passwordHash = hash; vault[idx].mustChange = false; }
      else { vault.push({ userId: req.user!.userId, email: req.user!.email, passwordHash: hash, mustChange: false }); }
      await saveVault(vault);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

export default router;
