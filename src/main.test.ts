import { describe, it, expect } from 'vitest';

describe('Application', () => {
    it('should pass a basic test', () => {
        expect(1 + 1).toBe(2);
    });

    it('should handle strings', () => {
        const greeting = 'Hello, World!';
        expect(greeting).toContain('Hello');
    });
});
