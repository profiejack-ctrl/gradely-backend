import bcrypt from 'bcryptjs';
import { supabase } from './supabase';

export interface VaultEntry {
  userId: string;
  email: string;
  passwordHash: string;
  mustChange: boolean;
}

interface LegacyCredential {
  customPassword?: unknown;
  passwordHash?: unknown;
  mustChangePassword?: unknown;
}

const isBcryptHash = (value: unknown): value is string =>
  typeof value === 'string' && /^\$2[aby]\$/.test(value);

const normalize = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

/**
 * Reads the server-only credential vault. A legacy object-map vault is
 * migrated once to bcrypt entries and immediately overwritten, so plaintext
 * passwords are never returned to the application or retained in storage.
 */
export async function getVault(): Promise<VaultEntry[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('grading_matrix_templates')
    .select('matrix')
    .eq('id', 'sys-auth-vault')
    .maybeSingle();

  if (error) {
    console.warn(`[vault] Unable to read credential vault: ${error.message}`);
    return [];
  }
  if (!data || data.matrix === null || data.matrix === undefined) return [];

  if (Array.isArray(data.matrix)) {
    return (data.matrix as VaultEntry[]).filter(entry =>
      Boolean(entry && entry.userId && entry.email && isBcryptHash(entry.passwordHash))
    );
  }

  if (typeof data.matrix !== 'object') return [];

  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id,email,student_number');
  if (usersError) throw new Error(`Unable to map legacy credentials: ${usersError.message}`);
  if (!users || users.length === 0) return [];

  const legacyMap = data.matrix as Record<string, LegacyCredential | string>;
  const migrated: VaultEntry[] = [];

  for (const user of users) {
    const keys = [user.id, user.email, user.student_number]
      .map(normalize)
      .filter(Boolean);
    const legacy = keys
      .map(key => legacyMap[key])
      .find(Boolean);

    if (!legacy) continue;

    const legacyRecord = typeof legacy === 'string' ? { customPassword: legacy } : legacy;
    const legacyHash = legacyRecord?.passwordHash;
    const legacyPassword = legacyRecord?.customPassword;

    if (!isBcryptHash(legacyHash) &&
        (typeof legacyPassword !== 'string' || legacyPassword.trim().length === 0)) {
      continue;
    }

    migrated.push({
      userId: user.id,
      email: user.email,
      passwordHash: isBcryptHash(legacyHash)
        ? legacyHash
        : await bcrypt.hash(legacyPassword as string, 12),
      mustChange: Boolean(
        typeof legacyRecord?.mustChangePassword === 'boolean' && legacyRecord.mustChangePassword
      ),
    });
  }

  if (migrated.length > 0) await saveVault(migrated);
  return migrated;
}

export async function saveVault(entries: VaultEntry[]): Promise<void> {
  if (!supabase) throw new Error('Database is not configured');

  const safeEntries = entries.filter(entry =>
    Boolean(entry && entry.userId && entry.email && isBcryptHash(entry.passwordHash))
  );

  const { error } = await supabase.from('grading_matrix_templates').upsert({
    id: 'sys-auth-vault',
    name: '__auth_vault__',
    description: 'System auth vault - do not delete',
    is_default: false,
    passing_grade: 0,
    matrix: safeEntries,
  }, { onConflict: 'id' });

  if (error) {
    console.warn(`[vault] Unable to save credential vault: ${error.message}`);
  }
}

/** Remove hashes for accounts that no longer exist. */
export async function pruneVaultToActiveUsers(): Promise<void> {
  if (!supabase) return;

  const { data: users, error } = await supabase.from('users').select('id');
  if (error) throw new Error(`Unable to inspect active users: ${error.message}`);

  const activeIds = new Set((users || []).map(user => user.id));
  const vault = await getVault();
  const filtered = vault.filter(entry => activeIds.has(entry.userId));

  if (filtered.length !== vault.length) await saveVault(filtered);
}
