/**
 * Help Modal Management
 * Handles showing/hiding the help overlay and first-use detection
 */

import { getHelpSeen, setHelpSeen } from '@/utils/settings';

/**
 * Show the help modal
 */
function showHelpModal(): void {
    const modal = document.getElementById('help-modal');
    if (modal) {
        modal.hidden = false;
        // Focus the close button for keyboard users
        const closeBtn = document.getElementById('help-close');
        closeBtn?.focus();
    }
}

/**
 * Hide the help modal
 */
function hideHelpModal(): void {
    const modal = document.getElementById('help-modal');
    if (modal) {
        modal.hidden = true;
    }
}

/**
 * Set up help modal event handlers
 */
export function setupHelpHandlers(): void {
    // Help button in header
    const helpBtn = document.getElementById('help-btn');
    helpBtn?.addEventListener('click', showHelpModal);

    // Close button in modal
    const closeBtn = document.getElementById('help-close');
    closeBtn?.addEventListener('click', () => {
        hideHelpModal();
        setHelpSeen();
    });

    // Close on overlay click (outside modal)
    const overlay = document.getElementById('help-modal');
    overlay?.addEventListener('click', e => {
        if (e.target === overlay) {
            hideHelpModal();
            setHelpSeen();
        }
    });

    // Close on Escape key
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            const modal = document.getElementById('help-modal');
            if (modal && !modal.hidden) {
                hideHelpModal();
                setHelpSeen();
            }
        }
    });
}

/**
 * Show help modal on first visit
 */
export function showHelpIfFirstVisit(): void {
    if (!getHelpSeen()) {
        showHelpModal();
    }
}
