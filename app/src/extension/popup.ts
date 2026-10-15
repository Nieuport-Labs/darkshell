// The toolbar popup (and the same page opened in a tab): the whole wallet.
import { mount } from 'svelte';
import App from '../App.svelte';
import { startSync } from './sync';
import { resume, watchIdle } from './unlock';
import { loadLang } from '../lib/i18n/index.svelte';
import { loadFiat } from '../lib/price.svelte';
import '../design/index.css';

// the toolbar popup is sized by its page; in a tab (popup.html?tab) or the side panel (panel.html) it fills it
const html = document.documentElement;
html.classList.add('ext');
if (!new URLSearchParams(location.search).has('tab') && !html.hasAttribute('data-panel')) html.classList.add('ext-popup');
startSync();
watchIdle();
// still within the idle time: open without the PIN
await resume();
void loadFiat();
await loadLang();
mount(App, { target: document.getElementById('app')! });
