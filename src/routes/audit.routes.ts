import { Router, Response } from 'express';
import { requireAuth, requireDean, AuthRequest } from '../middleware/auth';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

const router = Router();
router.use(requireAuth, requireDean);

router.get('/', async (_req: AuthRequest, res: Response) => {
  if (!isSupabaseConfigured || !supabase) {
    res.status(503).json({ error: 'Database not configured' });
    return;
  }

  const requestedLimit = Number(_req.query.limit || 100);
  const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(1, requestedLimit)) : 100;
  const { data, error } = await supabase
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

export default router;
