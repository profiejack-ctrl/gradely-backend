"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getVault = getVault;
exports.saveVault = saveVault;
exports.pruneVaultToActiveUsers = pruneVaultToActiveUsers;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const supabase_1 = require("./supabase");
const isBcryptHash = (value) => typeof value === 'string' && /^\$2[aby]\$/.test(value);
const normalize = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
/**
 * Reads the server-only credential vault. A legacy object-map vault is
 * migrated once to bcrypt entries and immediately overwritten, so plaintext
 * passwords are never returned to the application or retained in storage.
 */
async function getVault() {
    if (!supabase_1.supabase)
        return [];
    const { data, error } = await supabase_1.supabase
        .from('grading_matrix_templates')
        .select('matrix')
        .eq('id', 'sys-auth-vault')
        .maybeSingle();
    if (error) {
        console.warn(`[vault] Unable to read credential vault: ${error.message}`);
        return [];
    }
    if (!data || data.matrix === null || data.matrix === undefined)
        return [];
    if (Array.isArray(data.matrix)) {
        return data.matrix.filter(entry => Boolean(entry && entry.userId && entry.email && isBcryptHash(entry.passwordHash)));
    }
    if (typeof data.matrix !== 'object')
        return [];
    const { data: users, error: usersError } = await supabase_1.supabase
        .from('users')
        .select('id,email,student_number');
    if (usersError)
        throw new Error(`Unable to map legacy credentials: ${usersError.message}`);
    if (!users || users.length === 0)
        return [];
    const legacyMap = data.matrix;
    const migrated = [];
    for (const user of users) {
        const keys = [user.id, user.email, user.student_number]
            .map(normalize)
            .filter(Boolean);
        const legacy = keys
            .map(key => legacyMap[key])
            .find(Boolean);
        if (!legacy)
            continue;
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
                : await bcryptjs_1.default.hash(legacyPassword, 12),
            mustChange: Boolean(typeof legacyRecord?.mustChangePassword === 'boolean' && legacyRecord.mustChangePassword),
        });
    }
    if (migrated.length > 0)
        await saveVault(migrated);
    return migrated;
}
async function saveVault(entries) {
    if (!supabase_1.supabase)
        throw new Error('Database is not configured');
    const safeEntries = entries.filter(entry => Boolean(entry && entry.userId && entry.email && isBcryptHash(entry.passwordHash)));
    const { error } = await supabase_1.supabase.from('grading_matrix_templates').upsert({
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
async function pruneVaultToActiveUsers() {
    if (!supabase_1.supabase)
        return;
    const { data: users, error } = await supabase_1.supabase.from('users').select('id');
    if (error)
        throw new Error(`Unable to inspect active users: ${error.message}`);
    const activeIds = new Set((users || []).map(user => user.id));
    const vault = await getVault();
    const filtered = vault.filter(entry => activeIds.has(entry.userId));
    if (filtered.length !== vault.length)
        await saveVault(filtered);
}
