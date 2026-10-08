import { mount } from 'svelte';
import App from './App.svelte';
import './design/index.css';

export default mount(App, { target: document.getElementById('app')! });

// dev-only handle for poking state from the browser console / tests
if (import.meta.env.DEV) {
	void Promise.all([import('./lib/wallet.svelte'), import('./lib/ui.svelte')]).then(([w, u]) => {
		(window as unknown as { __ds: unknown }).__ds = { wallet: w.wallet, ui: u.ui };
	});
}
