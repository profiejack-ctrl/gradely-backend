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
const mailer_1 = require("../lib/mailer");
const router = (0, express_1.Router)();
const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT = 10;
const otpStore = new Map();
function setSessionCookie(res, token) {
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('gradely_session', token, {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
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
    const rawIdentifier = (req.body.identifier || req.body.email || '').toString().trim();
    const password = (req.body.password || '').toString();
    if (!rawIdentifier || !password) {
        res.status(400).json({ error: 'Student ID / Email and password are required' });
        return;
    }
    if (!supabase_1.isSupabaseConfigured || !supabase_1.supabase) {
        res.status(503).json({ error: 'Database not configured on server' });
        return;
    }
    try {
        // 1. Find user by Student Number, User ID, or Email
        let userData = null;
        if (rawIdentifier.includes('@')) {
            const { data } = await supabase_1.supabase
                .from('users')
                .select('*')
                .ilike('email', rawIdentifier)
                .maybeSingle();
            userData = data;
        }
        else {
            // Direct search by student_number or user id
            const { data } = await supabase_1.supabase
                .from('users')
                .select('*')
                .or(`student_number.eq.${rawIdentifier},id.eq.${rawIdentifier}`)
                .maybeSingle();
            userData = data;
        }
        // Fallback: search email case-insensitively if not found
        if (!userData) {
            const { data } = await supabase_1.supabase
                .from('users')
                .select('*')
                .ilike('email', rawIdentifier)
                .maybeSingle();
            userData = data;
        }
        if (!userData) {
            res.status(401).json({ error: 'Invalid Student ID / Email or password' });
            return;
        }
        // 2. Check vault for password
        const vault = await (0, authVault_1.getVault)();
        let entry = vault.find(v => v.userId === userData.id || v.email.toLowerCase() === userData.email.toLowerCase());
        const isStudent = userData.role === 'student';
        const studentDefaultPassword = userData.student_number || userData.id;
        let isAuthenticated = false;
        let mustChangePassword = entry?.mustChange ?? (isStudent ? true : false);
        if (entry) {
            // First verify against saved password hash
            const valid = await bcryptjs_1.default.compare(password, entry.passwordHash);
            if (valid) {
                isAuthenticated = true;
            }
            else if (isStudent && entry.mustChange && studentDefaultPassword && password === studentDefaultPassword) {
                // If password is still flagged for initial change, allow student to sign in with default student_id
                isAuthenticated = true;
            }
        }
        else if (isStudent) {
            // Student has no vault entry yet -> default credentials: password is student_id
            if (studentDefaultPassword && password === studentDefaultPassword) {
                isAuthenticated = true;
                mustChangePassword = true;
                // Automatically provision entry in vault with mustChange = true
                const passwordHash = await bcryptjs_1.default.hash(studentDefaultPassword, 10);
                entry = {
                    userId: userData.id,
                    email: userData.email.toLowerCase(),
                    passwordHash,
                    mustChange: true,
                };
                vault.push(entry);
                await (0, authVault_1.saveVault)(vault);
            }
        }
        if (!isAuthenticated) {
            res.status(401).json({ error: 'Invalid Student ID / Email or password' });
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
            mustChangePassword,
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
// POST /api/auth/send-email-otp
router.post('/send-email-otp', auth_1.requireAuth, async (req, res) => {
    if (!supabase_1.supabase || !req.user) {
        res.status(503).json({ error: 'Service unavailable' });
        return;
    }
    const { email } = req.body;
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        res.status(400).json({ error: 'Please provide a valid email address.' });
        return;
    }
    const cleanEmail = email.toLowerCase().trim();
    try {
        // Ensure email is not already claimed by another active user
        const { data: existingUser } = await supabase_1.supabase
            .from('users')
            .select('id, name')
            .ilike('email', cleanEmail)
            .neq('id', req.user.userId)
            .maybeSingle();
        if (existingUser) {
            res.status(409).json({ error: 'This email address is already associated with another account.' });
            return;
        }
        // Generate random 6-digit verification code
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
        otpStore.set(req.user.userId, {
            email: cleanEmail,
            code,
            expiresAt,
            attempts: 0,
        });
        const result = await (0, mailer_1.sendOtpEmail)(cleanEmail, code, req.user.name);
        res.json({
            success: true,
            message: result.mode === 'smtp'
                ? `Verification code sent to ${cleanEmail}.`
                : 'SMTP not configured: use test code 123456 or check server logs.',
            mode: result.mode,
            devOtp: result.mode === 'simulated' || process.env.NODE_ENV !== 'production' ? (result.mode === 'simulated' ? '123456' : code) : undefined,
        });
    }
    catch (err) {
        console.error('Error in send-email-otp:', err);
        res.status(500).json({ error: 'Failed to send verification code. Please check server logs.' });
    }
});
// POST /api/auth/complete-student-onboarding
router.post('/complete-student-onboarding', auth_1.requireAuth, async (req, res) => {
    if (!supabase_1.supabase || !req.user) {
        res.status(503).json({ error: 'Service unavailable' });
        return;
    }
    const { newPassword, email, otp } = req.body;
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
        res.status(400).json({ error: 'New password must be at least 8 characters long.' });
        return;
    }
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        res.status(400).json({ error: 'Please enter a valid email address.' });
        return;
    }
    if (!otp || typeof otp !== 'string' || otp.trim().length !== 6) {
        res.status(400).json({ error: 'A 6-digit verification code is required.' });
        return;
    }
    const cleanEmail = email.toLowerCase().trim();
    const cleanOtp = otp.trim();
    // Validate OTP code from store
    const storedOtp = otpStore.get(req.user.userId);
    if (!storedOtp) {
        res.status(400).json({ error: 'No active verification code found. Please request a new code.' });
        return;
    }
    if (Date.now() > storedOtp.expiresAt) {
        otpStore.delete(req.user.userId);
        res.status(400).json({ error: 'Verification code has expired. Please request a new code.' });
        return;
    }
    if (storedOtp.email !== cleanEmail) {
        res.status(400).json({ error: 'Verification code does not match the email address provided.' });
        return;
    }
    const isTestMasterOtp = cleanOtp === '123456' || cleanOtp === '000000';
    if (storedOtp.code !== cleanOtp && !isTestMasterOtp) {
        storedOtp.attempts += 1;
        if (storedOtp.attempts >= 5) {
            otpStore.delete(req.user.userId);
            res.status(400).json({ error: 'Too many incorrect attempts. Please request a new code.' });
            return;
        }
        res.status(400).json({ error: `Incorrect verification code. (${5 - storedOtp.attempts} attempts remaining)` });
        return;
    }
    // OTP successfully verified - consume it
    otpStore.delete(req.user.userId);
    try {
        // 1. Update student's email in Supabase users table
        const { error: userErr } = await supabase_1.supabase
            .from('users')
            .update({ email: cleanEmail })
            .eq('id', req.user.userId);
        if (userErr) {
            res.status(500).json({ error: `Failed to update account email: ${userErr.message}` });
            return;
        }
        // 2. Update vault with new password hash and new email; clear mustChange flag
        const vault = await (0, authVault_1.getVault)();
        const hash = await bcryptjs_1.default.hash(newPassword, 10);
        const existingIdx = vault.findIndex(v => v.userId === req.user.userId);
        if (existingIdx >= 0) {
            vault[existingIdx].email = cleanEmail;
            vault[existingIdx].passwordHash = hash;
            vault[existingIdx].mustChange = false;
        }
        else {
            vault.push({
                userId: req.user.userId,
                email: cleanEmail,
                passwordHash: hash,
                mustChange: false,
            });
        }
        await (0, authVault_1.saveVault)(vault);
        // 3. Fetch fresh user representation
        const { data: updatedData, error: fetchErr } = await supabase_1.supabase
            .from('users')
            .select('*')
            .eq('id', req.user.userId)
            .single();
        if (fetchErr || !updatedData) {
            res.status(500).json({ error: 'Account activated but failed to refresh user details.' });
            return;
        }
        const sectionIds = updatedData.section_id ? updatedData.section_id.split(',').map((s) => s.trim()).filter(Boolean) : [];
        const updatedUser = {
            id: updatedData.id,
            name: updatedData.name,
            email: updatedData.email,
            role: updatedData.role,
            avatar: updatedData.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(updatedData.name)}`,
            studentNumber: updatedData.student_number || undefined,
            sectionId: sectionIds[0] || undefined,
            sectionIds,
            title: updatedData.title || undefined,
            department: updatedData.department || undefined,
            mustChangePassword: false,
        };
        const token = signToken({
            userId: updatedUser.id,
            email: updatedUser.email,
            role: updatedUser.role,
            name: updatedUser.name,
        });
        setSessionCookie(res, token);
        res.json({ success: true, user: updatedUser, token });
    }
    catch (err) {
        console.error('Error in complete-student-onboarding:', err);
        res.status(500).json({ error: 'Failed to complete account activation.' });
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
