/**
 * Bus Route Filter Modal
 * Lets the user pick which bus route numbers to show, built live from
 * whatever routes are currently being served at nearby stops.
 */

import {
    getAllDisplayItems,
    getSelectedRoutes,
    setSelectedRoutes,
    hasReachedMaxRadius,
} from '@/core/app-state';
import { getRouteFilter, setRouteFilter } from '@/utils/settings';
import { escapeHtml } from '@/utils/html';
import { displayItems } from './render';
import { setupAllHandlers } from './event-handlers';

/**
 * Get the distinct bus route numbers currently known, sorted naturally
 * (so "2" comes before "10", and "71" before "X30").
 */
function getAvailableRoutes(): string[] {
    const lines = new Set<string>();
    for (const item of getAllDisplayItems()) {
        if (item.type !== 'bus') continue;
        for (const departure of item.data.departures) {
            lines.add(departure.line);
        }
    }

    return [...lines].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function renderRouteFilterList(): string {
    const availableRoutes = getAvailableRoutes();
    if (availableRoutes.length === 0) {
        return '<p class="no-departures">No bus routes found yet - check back once departures have loaded.</p>';
    }

    const selectedRoutes = getSelectedRoutes();
    return availableRoutes
        .map(line => {
            const checked = selectedRoutes.has(line) ? 'checked' : '';
            const escapedLine = escapeHtml(line);
            return `
                <label class="route-filter-item">
                    <input type="checkbox" value="${escapedLine}" ${checked} />
                    <span class="line-badge">${escapedLine}</span>
                </label>
            `;
        })
        .join('');
}

function updateFilterButtonLabel(): void {
    const btn = document.getElementById('route-filter-btn');
    if (!btn) return;

    const count = getSelectedRoutes().size;
    btn.textContent = count > 0 ? `Filter (${count})` : 'Filter';
    btn.classList.toggle('active', count > 0);
    btn.setAttribute('aria-pressed', count > 0 ? 'true' : 'false');
}

function rerenderDepartures(): void {
    displayItems(getAllDisplayItems(), !hasReachedMaxRadius(), setupAllHandlers);
}

function showRouteFilterModal(): void {
    const modal = document.getElementById('route-filter-modal');
    const list = document.getElementById('route-filter-list');
    if (!modal || !list) return;

    list.innerHTML = renderRouteFilterList();
    modal.hidden = false;

    const closeBtn = document.getElementById('route-filter-close');
    closeBtn?.focus();
}

function hideRouteFilterModal(): void {
    const modal = document.getElementById('route-filter-modal');
    if (modal) {
        modal.hidden = true;
    }
}

function handleRouteFilterListChange(e: Event): void {
    const target = e.target;
    if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return;

    const selectedRoutes = new Set(getSelectedRoutes());
    if (target.checked) {
        selectedRoutes.add(target.value);
    } else {
        selectedRoutes.delete(target.value);
    }

    setSelectedRoutes(selectedRoutes);
    setRouteFilter([...selectedRoutes]);
    updateFilterButtonLabel();
    rerenderDepartures();
}

function handleClearFilter(): void {
    setSelectedRoutes(new Set());
    setRouteFilter([]);
    updateFilterButtonLabel();
    rerenderDepartures();

    const list = document.getElementById('route-filter-list');
    if (list) {
        list.innerHTML = renderRouteFilterList();
    }
}

/**
 * Set up route filter modal event handlers
 */
function setupRouteFilterHandlers(): void {
    const filterBtn = document.getElementById('route-filter-btn');
    filterBtn?.addEventListener('click', showRouteFilterModal);

    const closeBtn = document.getElementById('route-filter-close');
    closeBtn?.addEventListener('click', hideRouteFilterModal);

    const clearBtn = document.getElementById('route-filter-clear');
    clearBtn?.addEventListener('click', handleClearFilter);

    const list = document.getElementById('route-filter-list');
    list?.addEventListener('change', handleRouteFilterListChange);

    const overlay = document.getElementById('route-filter-modal');
    overlay?.addEventListener('click', e => {
        if (e.target === overlay) {
            hideRouteFilterModal();
        }
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            const modal = document.getElementById('route-filter-modal');
            if (modal && !modal.hidden) {
                hideRouteFilterModal();
            }
        }
    });
}

/**
 * Restore the persisted route filter and wire up the modal.
 * Call once at startup, before the first render.
 */
export function initializeRouteFilter(): void {
    setSelectedRoutes(new Set(getRouteFilter()));
    updateFilterButtonLabel();
    setupRouteFilterHandlers();
}
