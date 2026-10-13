// The approval window the background opens for a site's request.
import { mount } from 'svelte';
import ApproveApp from './ApproveApp.svelte';
import '../design/index.css';

mount(ApproveApp, { target: document.getElementById('app')! });
