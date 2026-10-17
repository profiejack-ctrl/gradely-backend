"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const supabase_1 = require("../lib/supabase");
const authVault_1 = require("../lib/authVault");
const auth_1 = require("../middleware/auth");
const helpers_1 = require("../lib/helpers");
const router = (0, express_1.Router)();
const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT = 10;
function setSessionCookie(res, token) {
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
function signToken(payload) {
    const secret = process.env.JWT_SECRET;
    if (!secret)
        throw new Error('JWT_SECRET is not configured');
    const expiresIn = (process.env.JWT_EXPIRES_IN || '2h');
    return jsonwebtoken_1.default.sign(payload, secret, { expiresIn });
}
// POST /api/auth/login
router.post('/login', async (req, res) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const attempt = loginAttempts.get(key);
    if (attempt && attempt.resetAt > now && attempt.count >= LOGIN_LIMIT) {
        res.status(429).json({ error: 'Too many login attempts. Try again later.' });
        return;
    }
    if (!attempt || attempt.resetAt <= now)
        loginAttempts.set(key, { count: 0, resetAt: now + LOGIN_WINDOW_MS });
    loginAttempts.get(key).count += 1;
    const { email, password } = req.body;
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
        res.status(400).json({ error: 'Email and password are required' });
        return;
    }
    if (!supabase_1.isSupabaseConfigured || !supabase_1.supabase) {
        res.status(503).json({ error: 'Database not configured on server' });
        return;
    }
    try {
        // 1. Find user
        const { data: userData, error: userErr } = await supabase_1.supabase
            .from('users')
            .select('*')
            .eq('email', email.toLowerCase().trim())
            .single();
        if (userErr || !userData) {
            res.status(401).json({ error: 'Invalid email or password' });
            return;
        }
        // 2. Check vault for password
        const vault = await (0, authVault_1.getVault)();
        const entry = vault.find(v => v.email.toLowerCase() === email.toLowerCase().trim());
        if (entry) {
            const valid = await bcryptjs_1.default.compare(password, entry.passwordHash);
            if (!valid) {
                res.status(401).json({ error: 'Invalid email or password' });
                return;
            }
        }
        else {
            res.status(401).json({ error: 'Account credentials have not been provisioned' });
            return;
        }
        const sectionIds = userData.section_id ? userData.section_id.split(',').map((s) => s.trim()).filter(Boolean) : [];
        const user = {
            id: userData.id,
            name: userData.name,
            email: userData.email,
            role: userData.role,
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
    }
    catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error during login' });
    }
});
// POST /api/auth/register (Dean-only or initial setup when no users exist)
router.post('/register', async (req, res) => {
    if (!supabase_1.isSupabaseConfigured || !supabase_1.supabase) {
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
        const { count } = await supabase_1.supabase.from('users').select('*', { count: 'exact', head: true });
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
                if (!secret)
                    throw new Error('JWT_SECRET is not configured');
                const decoded = jsonwebtoken_1.default.verify(registrationToken, secret);
                if (decoded.role !== 'dean') {
                    res.status(403).json({ error: 'Dean access required to register new users' });
                    return;
                }
            }
            catch {
                res.status(401).json({ error: 'Invalid or expired token' });
                return;
            }
        }
        // Check if email already registered
        const { data: existingUser } = await supabase_1.supabase
            .from('users')
            .select('id')
            .eq('email', email.toLowerCase().trim())
            .maybeSingle();
        if (existingUser) {
            res.status(409).json({ error: 'User with this email already exists' });
            return;
        }
        const assignedRole = isFirstUser ? 'dean' : role;
        const userId = (0, helpers_1.generateId)('usr');
        const avatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name.trim())}`;
        // Insert user record
        const { error: insertErr } = await supabase_1.supabase.from('users').insert({
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
        const passwordHash = await bcryptjs_1.default.hash(password, 10);
        const vault = await (0, authVault_1.getVault)();
        vault.push({
            userId,
            email: email.toLowerCase().trim(),
            passwordHash,
            mustChange: !isFirstUser,
        });
        await (0, authVault_1.saveVault)(vault);
        const newUser = {
            id: userId,
            name: name.trim(),
            email: email.toLowerCase().trim(),
            role: assignedRole,
            avatar,
            studentNumber: studentNumber || undefined,
            sectionId: sectionId || undefined,
            sectionIds: sectionId ? (0, helpers_1.parseSectionIds)(sectionId) : [],
            title: title || undefined,
            department: department || undefined,
            mustChangePassword: !isFirstUser,
        };
        const token = signToken({ userId: newUser.id, email: newUser.email, role: newUser.role, name: newUser.name });
        setSessionCookie(res, token);
        res.status(201).json({ user: newUser, token });
    }
    catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ error: 'Server error during registration' });
    }
});
// GET /api/auth/me
router.get('/me', auth_1.requireAuth, async (req, res) => {
    if (!supabase_1.supabase || !req.user) {
        res.status(503).json({ error: 'Service unavailable' });
        return;
    }
    try {
        const { data, error } = await supabase_1.supabase.from('users').select('*').eq('id', req.user.userId).single();
        if (error || !data) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        const sectionIds = data.section_id ? data.section_id.split(',').map((s) => s.trim()).filter(Boolean) : [];
        res.json({
            id: data.id, name: data.name, email: data.email, role: data.role,
            avatar: data.avatar, studentNumber: data.student_number || undefined,
            sectionId: sectionIds[0] || undefined, sectionIds,
            title: data.title || undefined, department: data.department || undefined,
        });
    }
    catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});
// POST /api/auth/change-password
router.post('/change-password', auth_1.requireAuth, async (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters' });
        return;
    }
    try {
        const vault = await (0, authVault_1.getVault)();
        const hash = await bcryptjs_1.default.hash(newPassword, 10);
        const existing = vault.findIndex(v => v.userId === req.user.userId);
        if (existing >= 0) {
            vault[existing].passwordHash = hash;
            vault[existing].mustChange = false;
        }
        else {
            vault.push({ userId: req.user.userId, email: req.user.email, passwordHash: hash, mustChange: false });
        }
        await (0, authVault_1.saveVault)(vault);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to update password' });
    }
});
router.post('/logout', (_req, res) => {
    res.clearCookie('gradely_session', { httpOnly: true, sameSite: 'lax', path: '/' });
    res.json({ success: true });
});
// POST /api/auth/verify-password
router.post('/verify-password', auth_1.requireAuth, async (req, res) => {
    const { password } = req.body;
    if (!password || typeof password !== 'string') {
        res.status(400).json({ error: 'Password is required' });
        return;
    }
    try {
        const vault = await (0, authVault_1.getVault)();
        const entry = vault.find(v => v.userId === req.user.userId);
        const valid = Boolean(entry && await bcryptjs_1.default.compare(password, entry.passwordHash));
        res.json({ valid });
    }
    catch {
        res.status(500).json({ error: 'Failed to verify password' });
    }
});
// PUT /api/auth/profile
router.put('/profile', auth_1.requireAuth, async (req, res) => {
    if (!supabase_1.supabase || !req.user) {
        res.status(503).json({ error: 'Service unavailable' });
        return;
    }
    const { name, avatar, title, department, newPassword } = req.body;
    try {
        const updates = {};
        if (name)
            updates.name = name.trim();
        if (avatar !== undefined)
            updates.avatar = avatar;
        if (title !== undefined)
            updates.title = title;
        if (department !== undefined)
            updates.department = department;
        if (Object.keys(updates).length > 0) {
            const { error } = await supabase_1.supabase.from('users').update(updates).eq('id', req.user.userId);
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
            const vault = await (0, authVault_1.getVault)();
            const hash = await bcryptjs_1.default.hash(newPassword, 10);
            const idx = vault.findIndex(v => v.userId === req.user.userId);
            if (idx >= 0) {
                vault[idx].passwordHash = hash;
                vault[idx].mustChange = false;
            }
            else {
                vault.push({ userId: req.user.userId, email: req.user.email, passwordHash: hash, mustChange: false });
            }
            await (0, authVault_1.saveVault)(vault);
        }
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to update profile' });
    }
});
exports.default = router;
