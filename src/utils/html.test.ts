import { describe, it, expect } from 'vitest';
import { escapeHtml } from './html';

describe('escapeHtml', () => {
    it('escapes HTML special characters', () => {
        expect(escapeHtml(`<img src=x onerror="alert('x')">&`)).toBe(
            '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;'
        );
    });

    it('leaves ordinary text unchanged', () => {
        expect(escapeHtml('Chelmsford Bus Station')).toBe('Chelmsford Bus Station');
    });
});
