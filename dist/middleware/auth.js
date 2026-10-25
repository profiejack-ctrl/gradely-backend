"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
exports.requireDean = requireDean;
exports.requireFaculty = requireFaculty;
exports.requireStudent = requireStudent;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const supabase_1 = require("../lib/supabase");
async function requireAuth(req, res, next) {
    if (!supabase_1.isSupabaseConfigured || !supabase_1.supabase) {
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
        const decoded = jsonwebtoken_1.default.verify(token, secret);
        const { data: user, error } = await supabase_1.supabase
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
    }
    catch (err) {
        console.warn(`[auth] 401 Unauthorized: Token verification failed on ${req.method} ${req.originalUrl || req.path}:`, err?.message || err);
        res.status(401).json({ error: 'Invalid or expired token' });
    }
}
function requireDean(req, res, next) {
    if (!req.user || (req.user.role !== 'dean')) {
        res.status(403).json({ error: 'Dean access required' });
        return;
    }
    next();
}
function requireFaculty(req, res, next) {
    if (!req.user || (req.user.role !== 'dean' && req.user.role !== 'teacher')) {
        res.status(403).json({ error: 'Faculty access required' });
        return;
    }
    next();
}
/** Restrict a route to the authenticated student's own account. */
function requireStudent(req, res, next) {
    if (!req.user || req.user.role !== 'student') {
        res.status(403).json({ error: 'Student access required' });
        return;
    }
    next();
}
