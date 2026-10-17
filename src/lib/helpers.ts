/**
 * Encodes adviser ID into the section description field
 * Format: "[adviser:UUID] actual description"
 */
export function encodeSectionDescription(description?: string, adviserId?: string): string {
  if (!adviserId) return description || '';
  const base = description ? description.replace(/^\[adviser:[^\]]+\]\s*/, '').trim() : '';
  return `[adviser:${adviserId}]${base ? ` ${base}` : ''}`;
}

/**
 * Decodes adviser ID from the section description field
 */
export function decodeSectionDescription(raw?: string | null): { description: string; adviserId?: string } {
  if (!raw) return { description: '' };
  const match = raw.match(/^\[adviser:([^\]]+)\]\s*(.*)$/);
  if (match) {
    return { description: match[2].trim(), adviserId: match[1] };
  }
  return { description: raw };
}

/**
 * Parses a comma-separated section_id string into an array of section IDs
 */
export function parseSectionIds(raw?: string | null): string[] {
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Formats an array of section IDs into a comma-separated string
 */
export function formatSectionIds(ids: string[]): string {
  return [...new Set(ids)].filter(Boolean).join(',');
}

/**
 * Generates a short unique ID
 */
export function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}`;
}
