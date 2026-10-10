import { mount } from 'svelte';
import { gateNetwork } from './lib/tor.svelte';
import App from './App.svelte';
import PaySheetApp from './PaySheetApp.svelte';
import { sheetRequest } from './lib/pay/sheet';
import './design/index.css';

// with Tor on, nothing goes out before Tor is connected (lib/tor.svelte.ts)
gateNetwork();

// a payment link or another app opened the payment sheet (android PayActivity):
// only the sheet runs in this WebView; otherwise the wallet app
const target = document.getElementById('app')!;
export default sheetRequest().then((request) => (request ? mount(PaySheetApp, { target, props: { request } }) : mount(App, { target })));

// dev-only handle for poking state from the browser console / tests
if (import.meta.env.DEV) {
	void Promise.all([import('./lib/wallet.svelte'), import('./lib/ui.svelte')]).then(([w, u]) => {
		(window as unknown as { __ds: unknown }).__ds = { wallet: w.wallet, ui: u.ui };
	});
}
