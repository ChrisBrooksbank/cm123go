/**
 * HTML Utilities
 */

const HTML_ESCAPES = new Map([
    ['&', '&amp;'],
    ['<', '&lt;'],
    ['>', '&gt;'],
    ['"', '&quot;'],
    ["'", '&#39;'],
]);

/**
 * Escape a string for safe interpolation into HTML text or attribute values.
 * Use for any data that comes from an external API or user input.
 */
export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, char => HTML_ESCAPES.get(char) ?? char);
}
