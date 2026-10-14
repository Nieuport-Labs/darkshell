// Builds the browser extension: `node extension/build.mjs` (from app/).
// → dist-extension/chrome and dist-extension/firefox, each ready to load
//   unpacked (chrome://extensions, about:debugging) or to zip for a store.
// The pages (popup = the whole wallet, panel = the same in the side panel,
// approve = the approval window) are the
// same Svelte app; the background, content and in-page scripts are single
// files, as content scripts and Firefox backgrounds can't be ES modules.

import { svelte } from '@sveltejs/vite-plugin-svelte';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const app = fileURLToPath(new URL('..', import.meta.url));
const out = `${app}dist-extension`;
const common = `${out}/common`;
const version = /versionName "([\d.]+)"/.exec(readFileSync(`${app}android/app/build.gradle`, 'utf8'))?.[1] ?? '0.0.0';

const shared = {
	configFile: false,
	envDir: app,
	resolve: { alias: { 'secret-pay': fileURLToPath(new URL('../../packages/secret-pay/src/index.ts', import.meta.url)) } },
	define: { global: 'globalThis' },
	logLevel: 'warn',
};

rmSync(out, { recursive: true, force: true });

// 1. the pages
await build({
	...shared,
	root: `${app}extension`,
	base: './',
	publicDir: `${app}public`,
	plugins: [svelte()],
	build: {
		outDir: common,
		emptyOutDir: true,
		target: 'es2022',
		cssTarget: ['chrome110', 'firefox128'],
		chunkSizeWarningLimit: 4096,
		rollupOptions: { input: { popup: `${app}extension/popup.html`, panel: `${app}extension/panel.html`, approve: `${app}extension/approve.html` } },
	},
});

// 2. the scripts, one self-contained file each
for (const name of ['background', 'content', 'inpage']) {
	await build({
		...shared,
		define: { ...shared.define, 'process.env.NODE_ENV': '"production"' },
		publicDir: false,
		build: {
			outDir: common,
			emptyOutDir: false,
			target: 'es2022',
			minify: true,
			lib: { entry: `${app}src/extension/${name}.ts`, formats: ['iife'], name: `darkshell_${name}`, fileName: () => `${name}.js` },
		},
	});
}

// 3. one manifest per browser
const hosts = ['https://ff.io/*', 'https://faucet.libertarianskastrana.cz/*'];
const base = {
	manifest_version: 3,
	name: 'DarkShell',
	version,
	description: 'A private sSCRT account on Secret Network. Connects to Secret dApps.',
	icons: { 16: 'favicon.png', 48: 'icon-192.png', 128: 'icon-192.png' },
	action: { default_popup: 'popup.html', default_title: 'DarkShell' },
	permissions: ['storage', 'alarms'],
	host_permissions: hosts,
	content_scripts: [
		{ matches: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'], js: ['content.js'], run_at: 'document_start', all_frames: false },
		{ matches: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'], js: ['inpage.js'], run_at: 'document_start', all_frames: false, world: 'MAIN' },
	],
	content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" },
};

const manifests = {
	chrome: {
		...base,
		minimum_chrome_version: '116',
		permissions: [...base.permissions, 'sidePanel'],
		side_panel: { default_path: 'panel.html' },
		background: { service_worker: 'background.js' },
	},
	firefox: {
		...base,
		background: { scripts: ['background.js'] },
		sidebar_action: { default_panel: 'panel.html', default_title: 'DarkShell', default_icon: 'favicon.png', open_at_install: false },
		browser_specific_settings: { gecko: { id: 'wallet@darkshell.cash', strict_min_version: '128.0' } },
	},
};

for (const [browser, manifest] of Object.entries(manifests)) {
	const dir = `${out}/${browser}`;
	mkdirSync(dir, { recursive: true });
	cpSync(common, dir, { recursive: true });
	writeFileSync(`${dir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
}
rmSync(common, { recursive: true, force: true });
console.log(`→ dist-extension/chrome, dist-extension/firefox (version ${version})`);
