"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const supabase_1 = require("../lib/supabase");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth, auth_1.requireDean);
router.get('/', async (_req, res) => {
    if (!supabase_1.isSupabaseConfigured || !supabase_1.supabase) {
        res.status(503).json({ error: 'Database not configured' });
        return;
    }
    const requestedLimit = Number(_req.query.limit || 100);
    const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(1, requestedLimit)) : 100;
    const { data, error } = await supabase_1.supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) {
        if (/does not exist|relation .* not found|could not find the table|schema cache/i.test(error.message)) {
            res.json([]);
            return;
        }
        res.status(500).json({ error: 'Failed to load audit logs' });
        return;
    }
    res.json(data || []);
});
exports.default = router;
