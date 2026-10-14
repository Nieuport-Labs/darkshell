// Content script (isolated world): carries requests from the page's provider
// (inpage.ts) to the background and the answers back. It decides nothing;
// the background takes the site's origin from the browser, not from here.

const TO_CONTENT = 'darkshell-content';
const TO_PAGE = 'darkshell-inpage';

window.addEventListener('message', (e: MessageEvent) => {
	if (e.source !== window || e.data?.to !== TO_CONTENT || !e.data.req) return;
	const req = e.data.req as { id: string };
	chrome.runtime
		.sendMessage({ type: 'darkshell:dapp', req })
		.then((res: unknown) => res ?? { id: req.id, error: 'DarkShell did not answer.' })
		.catch((err: unknown) => ({ id: req.id, error: err instanceof Error ? err.message : 'DarkShell is not available.' }))
		.then((res) => window.postMessage({ to: TO_PAGE, res }, location.origin));
});

chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
	if (msg?.type === 'darkshell:keystorechange') window.postMessage({ to: TO_PAGE, event: 'keystorechange' }, location.origin);
});
