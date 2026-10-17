"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeSectionDescription = encodeSectionDescription;
exports.decodeSectionDescription = decodeSectionDescription;
exports.parseSectionIds = parseSectionIds;
exports.formatSectionIds = formatSectionIds;
exports.generateId = generateId;
/**
 * Encodes adviser ID into the section description field
 * Format: "[adviser:UUID] actual description"
 */
function encodeSectionDescription(description, adviserId) {
    if (!adviserId)
        return description || '';
    const base = description ? description.replace(/^\[adviser:[^\]]+\]\s*/, '').trim() : '';
    return `[adviser:${adviserId}]${base ? ` ${base}` : ''}`;
}
/**
 * Decodes adviser ID from the section description field
 */
function decodeSectionDescription(raw) {
    if (!raw)
        return { description: '' };
    const match = raw.match(/^\[adviser:([^\]]+)\]\s*(.*)$/);
    if (match) {
        return { description: match[2].trim(), adviserId: match[1] };
    }
    return { description: raw };
}
/**
 * Parses a comma-separated section_id string into an array of section IDs
 */
function parseSectionIds(raw) {
    if (!raw)
        return [];
    return raw.split(',').map(s => s.trim()).filter(Boolean);
}
/**
 * Formats an array of section IDs into a comma-separated string
 */
function formatSectionIds(ids) {
    return [...new Set(ids)].filter(Boolean).join(',');
}
/**
 * Generates a short unique ID
 */
function generateId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}`;
}
