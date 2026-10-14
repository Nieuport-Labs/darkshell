// The browser extension's wallet in the browser's side panel (Chrome's
// sidePanel, Firefox's sidebar), so it stays open next to a dApp instead of
// closing like the toolbar popup. panel.html is the popup's page with
// `data-panel` on <html>.

import { platform } from './platform';

declare const browser: { sidebarAction?: { open(): Promise<void> } } | undefined;

export const inSidePanel = platform === 'extension' && document.documentElement.hasAttribute('data-panel');

const firefox = typeof browser !== 'undefined' ? browser?.sidebarAction : undefined;
const chromePanel = platform === 'extension' ? chrome.sidePanel : undefined;

// Chrome opens the panel only straight from a click: the window is looked up beforehand
let windowId: number | undefined;
if (chromePanel && !inSidePanel) void chrome.windows.getCurrent().then((w) => (windowId = w.id));

export const sidePanelAvailable = platform === 'extension' && !inSidePanel && !!(firefox?.open || chromePanel?.open);

/** Call from a click. The popup closes; the wallet opens in the side panel (still unlocked, see extension/unlock.ts). */
export function openSidePanel(): void {
	const opened = firefox?.open ? firefox.open() : windowId !== undefined ? chromePanel?.open({ windowId }) : undefined;
	void opened?.then(() => window.close());
}
