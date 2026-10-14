// Runs in the page itself (content script with world: MAIN) before the
// page's own scripts: puts `window.darkshell` (and `window.keplr`, if free)
// there, talking to the content script through window messages.

import { install } from '../lib/dapp/inject';
import type { DappResponse } from '../lib/dapp/protocol';

const TO_CONTENT = 'darkshell-content';
const TO_PAGE = 'darkshell-inpage';

const waiting = new Map<string, (r: DappResponse) => void>();
const changes: (() => void)[] = [];

window.addEventListener('message', (e: MessageEvent) => {
	if (e.source !== window || e.data?.to !== TO_PAGE) return;
	if (e.data.event === 'keystorechange') return changes.forEach((cb) => cb());
	const res = e.data.res as DappResponse | undefined;
	const done = res && waiting.get(res.id);
	if (done) {
		waiting.delete(res.id);
		done(res);
	}
});

install(
	{
		send: (req) =>
			new Promise((resolve) => {
				waiting.set(req.id, resolve);
				window.postMessage({ to: TO_CONTENT, req }, location.origin);
			}),
		onKeystoreChange: (cb) => changes.push(cb),
	},
	'extension',
);
