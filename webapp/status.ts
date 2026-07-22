// Status display helpers: set status bar, show/hide failure popup.

import { statusMessage } from './stores';

export function setStatus(statusBox: HTMLElement, type: string, msg: string): void {
  statusBox.className = type === 'error' || type === 'done' ? type : '';
  statusBox.textContent = msg;
  statusMessage.set({ type, text: msg });
}

export function showFailurePopup(msg: string, isWarning: boolean): void {
  const popup = document.getElementById('failure-popup')!;
  popup.className = isWarning ? 'warning' : 'error';
  document.getElementById('failure-popup-msg')!.textContent = msg;
  popup.style.display = 'flex';
}

export function hideFailurePopup(): void {
  document.getElementById('failure-popup')!.style.display = 'none';
}
