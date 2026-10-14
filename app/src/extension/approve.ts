// The approval window the background opens for a site's request.
import { mount } from 'svelte';
import ApproveApp from './ApproveApp.svelte';
import '../design/index.css';

document.documentElement.classList.add('ext');

mount(ApproveApp, { target: document.getElementById('app')! });
