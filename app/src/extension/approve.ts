// The approval window the background opens for a site's request.
import { mount } from 'svelte';
import ApproveApp from './ApproveApp.svelte';
import { loadLang } from '../lib/i18n/index.svelte';
import { loadFiat } from '../lib/price.svelte';
import '../design/index.css';

document.documentElement.classList.add('ext');

void loadFiat();
await loadLang();
mount(ApproveApp, { target: document.getElementById('app')! });
