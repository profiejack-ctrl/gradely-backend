import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { requireAuth, requireDean, AuthRequest } from '../middleware/auth';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { getVault, saveVault } from '../lib/authVault';
import { generateId, parseSectionIds } from '../lib/helpers';
import { UserRole } from '../types';
import { writeAudit } from '../lib/audit';

const router = Router();

// Protect all teacher management routes with Dean access
router.use(requireAuth);

// Reset a student's password for a dean, or for a teacher who owns one of the
// student's enrolled subjects. The generated temporary password is returned
// once and is never written to the database or browser storage.
router.post('/:id/reset-password', async (req: AuthRequest, res: Response) => {
  if (!isSupabaseConfigured || !supabase || !req.user) {
    res.status(503).json({ error: 'Database not configured' });
    return;
  }
  try {
    const { data: target, error: targetError } = await supabase
      .from('users')
      .select('id,name,email,role,student_number,section_id,avatar,title,department')
      .eq('id', req.params.id)
      .maybeSingle();
    if (targetError || !target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (req.user.role !== 'dean') {
      if (target.role !== 'student') {
        res.status(403).json({ error: 'Only deans may reset faculty passwords' });
        return;
      }
      const sectionIds = parseSectionIds(target.section_id);
      const { data: ownedSubjects } = await supabase
        .from('subjects')
        .select('section_id')
        .eq('teacher_id', req.user.userId)
        .in('section_id', sectionIds.length ? sectionIds : ['__none__']);
      if (!ownedSubjects || ownedSubjects.length === 0) {
        res.status(403).json({ error: 'You may reset passwords only for students in your subjects' });
        return;
      }
    }

    const temporaryPassword = crypto.randomBytes(9).toString('base64url');
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    const vault = await getVault();
    const existingIndex = vault.findIndex(entry => entry.userId === target.id);
    const nextEntry = { userId: target.id, email: target.email, passwordHash, mustChange: true };
    if (existingIndex >= 0) vault[existingIndex] = nextEntry;
    else vault.push(nextEntry);
    await saveVault(vault);

    await writeAudit({
      actorId: req.user.userId,
      actorRole: req.user.role,
      action: 'RESET_PASSWORD',
      tableName: 'users',
      recordId: target.id,
      metadata: { targetRole: target.role },
    });

    res.json({
      success: true,
      initialPassword: temporaryPassword,
      user: {
        id: target.id,
        name: target.name,
        email: target.email,
        role: target.role,
        studentNumber: target.student_number || undefined,
        sectionIds: parseSectionIds(target.section_id),
        sectionId: parseSectionIds(target.section_id)[0] || undefined,
        avatar: target.avatar,
        title: target.title || undefined,
        department: target.department || undefined,
        mustChangePassword: true,
      },
    });
  } catch (err) {
    console.error('Error resetting password:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

router.use(requireDean);

// GET /api/teachers - List all teachers and deans
router.get('/', async (req: AuthRequest, res: Response) => {
  if (!isSupabaseConfigured || !supabase) {
    res.status(503).json({ error: 'Database not configured' });
    return;
  }

  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .in('role', ['teacher', 'dean'])
      .order('name', { ascending: true });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const vault = await getVault();
    const vaultMap = new Map(vault.map(v => [v.userId, v]));

    const teachers = (data || []).map((u: any) => {
      const sectionIds = parseSectionIds(u.section_id);
      const vaultEntry = vaultMap.get(u.id);
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role as UserRole,
        avatar: u.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(u.name)}`,
        title: u.title || undefined,
        department: u.department || undefined,
        sectionId: sectionIds[0] || undefined,
        sectionIds,
        mustChangePassword: vaultEntry?.mustChange ?? false,
      };
    });

    res.json(teachers);
  } catch (err: any) {
    console.error('Error fetching teachers:', err);
    res.status(500).json({ error: 'Failed to fetch teachers' });
  }
});

// POST /api/teachers - Create new teacher/faculty member
router.post('/', async (req: AuthRequest, res: Response) => {
  if (!isSupabaseConfigured || !supabase) {
    res.status(503).json({ error: 'Database not configured' });
    return;
  }

  const { name, email, password, role = 'teacher', title, department } = req.body;

  if (!name || !email || typeof name !== 'string' || typeof email !== 'string') {
    res.status(400).json({ error: 'Name and email are required' });
    return;
  }

  try {
    const cleanEmail = email.toLowerCase().trim();
    if (name.trim().length < 2 || name.trim().length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      res.status(400).json({ error: 'Enter a valid name and email address' });
      return;
    }
    if (password !== undefined && (typeof password !== 'string' || password.length < 8)) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', cleanEmail)
      .maybeSingle();

    if (existingUser) {
      res.status(409).json({ error: 'User with this email already exists' });
      return;
    }

    const teacherId = generateId('usr');
    const avatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name.trim())}`;
    const generatedPassword = !password;
    const initialPassword = password || crypto.randomBytes(9).toString('base64url');

    // Insert user record
    const { error: insertError } = await supabase.from('users').insert({
      id: teacherId,
      name: name.trim(),
      email: cleanEmail,
      role: role === 'dean' ? 'dean' : 'teacher',
      avatar,
      title: title || null,
      department: department || null,
      student_number: null,
      section_id: null,
    });

    if (insertError) {
      res.status(500).json({ error: `Failed to create teacher: ${insertError.message}` });
      return;
    }

    // Hash password and store in vault
    const passwordHash = await bcrypt.hash(initialPassword, 10);
    const vault = await getVault();
    vault.push({
      userId: teacherId,
      email: cleanEmail,
      passwordHash,
      mustChange: true,
    });
    await saveVault(vault);

    const createdTeacher = {
      id: teacherId,
      name: name.trim(),
      email: cleanEmail,
      role: role === 'dean' ? 'dean' : 'teacher',
      avatar,
      title: title || undefined,
      department: department || undefined,
      mustChangePassword: true,
      ...(generatedPassword ? { initialPassword } : {}),
    };

    await writeAudit({
      actorId: req.user?.userId,
      actorRole: req.user?.role,
      action: 'CREATE',
      tableName: 'users',
      recordId: teacherId,
      after: createdTeacher,
    });

    res.status(201).json(createdTeacher);
  } catch (err: any) {
    console.error('Error creating teacher:', err);
    res.status(500).json({ error: 'Failed to create teacher' });
  }
});

// PUT /api/teachers/:id - Update teacher details
router.put('/:id', async (req: AuthRequest, res: Response) => {
  if (!isSupabaseConfigured || !supabase) {
    res.status(503).json({ error: 'Database not configured' });
    return;
  }

  const { id } = req.params;
  const { name, email, role, title, department, avatar, password } = req.body;

  try {
    const { data: before } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
    if (!before || !['teacher', 'dean'].includes(before.role)) {
      res.status(404).json({ error: 'Faculty account not found' });
      return;
    }
    const updates: any = {};
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 160) {
        res.status(400).json({ error: 'Invalid faculty name' });
        return;
      }
      updates.name = name.trim();
    }
    if (email !== undefined) {
      const cleanEmail = typeof email === 'string' ? email.toLowerCase().trim() : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        res.status(400).json({ error: 'Invalid faculty email' });
        return;
      }
      updates.email = cleanEmail;
    }
    if (role !== undefined && (role === 'teacher' || role === 'dean')) updates.role = role;
    if (title !== undefined) updates.title = title;
    if (department !== undefined) updates.department = department;
    if (avatar !== undefined) updates.avatar = avatar;

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabase
        .from('users')
        .update(updates)
        .eq('id', id);

      if (updateError) {
        res.status(500).json({ error: `Failed to update teacher: ${updateError.message}` });
        return;
      }
    }

    // If password or email changed, update vault
    if (password || (email !== undefined)) {
      if (password !== undefined && (typeof password !== 'string' || password.length < 8)) {
        res.status(400).json({ error: 'Password must be at least 8 characters' });
        return;
      }
      const vault = await getVault();
      const idx = vault.findIndex(v => v.userId === id);
      if (idx >= 0) {
        if (email !== undefined) vault[idx].email = email.toLowerCase().trim();
        if (password) {
          vault[idx].passwordHash = await bcrypt.hash(password, 10);
          vault[idx].mustChange = true;
        }
      } else if (password && email) {
        vault.push({
          userId: id,
          email: email.toLowerCase().trim(),
          passwordHash: await bcrypt.hash(password, 10),
          mustChange: true,
        });
      }
      await saveVault(vault);
    }

    // Retrieve updated record
    const { data: updatedData, error: fetchErr } = await supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !updatedData) {
      res.status(404).json({ error: 'Teacher not found' });
      return;
    }

    const result = {
      id: updatedData.id,
      name: updatedData.name,
      email: updatedData.email,
      role: updatedData.role,
      avatar: updatedData.avatar,
      title: updatedData.title || undefined,
      department: updatedData.department || undefined,
    };
    await writeAudit({
      actorId: req.user?.userId,
      actorRole: req.user?.role,
      action: password ? 'UPDATE_AND_RESET_PASSWORD' : 'UPDATE',
      tableName: 'users',
      recordId: id,
      before,
      after: result,
    });
    res.json(result);
  } catch (err: any) {
    console.error('Error updating teacher:', err);
    res.status(500).json({ error: 'Failed to update teacher' });
  }
});

// DELETE /api/teachers/:id - Remove teacher
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  if (!isSupabaseConfigured || !supabase) {
    res.status(503).json({ error: 'Database not configured' });
    return;
  }

  const { id } = req.params;

  // Prevent dean from deleting themselves
  if (req.user?.userId === id) {
    res.status(400).json({ error: 'Cannot delete your own account' });
    return;
  }

  try {
    const { data: before } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
    if (!before || !['teacher', 'dean'].includes(before.role)) {
      res.status(404).json({ error: 'Faculty account not found' });
      return;
    }
    // Delete from users table
    const { error: deleteError } = await supabase
      .from('users')
      .delete()
      .eq('id', id);

    if (deleteError) {
      res.status(500).json({ error: deleteError.message });
      return;
    }

    // Remove from vault
    const vault = await getVault();
    const filteredVault = vault.filter(v => v.userId !== id);
    if (filteredVault.length !== vault.length) {
      await saveVault(filteredVault);
    }

    await writeAudit({
      actorId: req.user?.userId,
      actorRole: req.user?.role,
      action: 'DELETE',
      tableName: 'users',
      recordId: id,
      before,
    });

    res.json({ success: true, message: 'Teacher deleted successfully' });
  } catch (err: any) {
    console.error('Error deleting teacher:', err);
    res.status(500).json({ error: 'Failed to delete teacher' });
  }
});

export default router;
