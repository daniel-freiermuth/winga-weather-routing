// Status display helpers: show/hide failure popup.

export interface FailurePopupCallbacks {
  show(msg: string, isWarning: boolean): void;
  hide(): void;
}

/**
 * Show the failure popup via callback.
 */
export function showFailurePopup(msg: string, isWarning: boolean, cb: FailurePopupCallbacks): void {
  cb.show(msg, isWarning);
}

/**
 * Hide the failure popup via callback.
 */
export function hideFailurePopup(cb: FailurePopupCallbacks): void {
  cb.hide();
}
