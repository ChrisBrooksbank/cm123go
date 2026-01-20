/**
 * UI Module Exports
 * Only exports what's needed by main.ts
 */

export {
    displayItems,
    displayError,
    showPostcodeEntryForm,
    updatePostcodeDisplay,
    hidePostcodeForm,
    showRefreshContainer,
    showPostcodeError,
    clearPostcodeError,
    setPostcodeFormBusy,
    updateLastUpdateDisplay,
    showLoadingDepartures,
} from './render';

export {
    setupAllHandlers,
    handleRefresh,
    setSetupHandlersCallback,
    setupPostcodeDisplayClickHandler,
} from './event-handlers';
