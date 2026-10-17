import { supabase } from './supabase';

export interface AuditEntry {
  actorId?: string;
  actorRole?: string;
  action: string;
  tableName: string;
  recordId?: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}

/**
 * Audit logging is intentionally best-effort. A missing audit table must not
 * make a legitimate grade or roster mutation fail while a migration is being
 * deployed. Once the schema migration is applied, all writes are recorded.
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase.from('audit_logs').insert({
    actor_id: entry.actorId || null,
    actor_role: entry.actorRole || null,
    action: entry.action,
    table_name: entry.tableName,
    record_id: entry.recordId || null,
    before_data: entry.before ?? null,
    after_data: entry.after ?? null,
    metadata: entry.metadata ?? null,
  });

  if (error && !/does not exist|relation .* not found|could not find the table|schema cache|permission denied/i.test(error.message)) {
    console.warn('Audit log write failed:', error.message);
  }
}
