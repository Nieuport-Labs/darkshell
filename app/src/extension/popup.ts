// The toolbar popup (and the same page opened in a tab): the whole wallet.
import { mount } from 'svelte';
import App from '../App.svelte';
import { startSync } from './sync';
import '../design/index.css';

// the toolbar popup is sized by its page: a phone-sized one (popup.html?tab, in a tab, fills the tab)
if (!new URLSearchParams(location.search).has('tab')) document.documentElement.classList.add('ext-popup');
startSync();
mount(App, { target: document.getElementById('app')! });
