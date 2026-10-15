import { svelte } from '@sveltejs/vite-plugin-svelte';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Content Security Policy for built pages (dev keeps Vite's inline client).
 * Scripts only from the app itself; 'wasm-unsafe-eval' is Argon2id (hash-wasm)
 * and the QR reader. Nodes are https (a node set in Settings may be http).
 */
const CSP = [
	"default-src 'self'",
	"script-src 'self' 'wasm-unsafe-eval'",
	"worker-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob: https:",
	"font-src 'self'",
	"connect-src 'self' https: wss: http:",
	"media-src 'self' blob:",
	"object-src 'none'",
	"frame-src 'none'",
	"base-uri 'none'",
	"form-action 'none'",
].join('; ');

export default defineConfig({
	plugins: [
		svelte(),
		{
			name: 'darkshell-csp',
			apply: 'build',
			transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
		},
		VitePWA({
			// The Android app ships its files inside the APK; a service worker there
			// would only serve stale builds after an update, so it removes itself.
			selfDestroying: process.env.CAPACITOR === '1',
			registerType: 'autoUpdate',
			includeAssets: ['favicon.png', 'avatar.webp'],
			manifest: {
				name: 'DarkShell',
				short_name: 'DarkShell',
				description: 'A private sSCRT account on Secret Network.',
				theme_color: '#080808',
				background_color: '#080808',
				display: 'standalone',
				orientation: 'portrait',
				start_url: '/',
				icons: [
					{ src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
					{ src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
				],
			},
			workbox: {
				globPatterns: ['**/*.{js,css,html,svg,png,webp,wasm,woff2}'],
				maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
				navigateFallback: '/index.html',
			},
		}),
	],
	resolve: {
		alias: {
			// use the standard's source directly so app and package never drift
			'secret-pay': fileURLToPath(new URL('../packages/secret-pay/src/index.ts', import.meta.url)),
		},
	},
	define: {
		global: 'globalThis',
	},
	build: {
		target: 'es2022',
		// say which browsers the CSS is for: with only a JS target the minifier kept
		// -webkit-backdrop-filter alone, which Android's WebView ignores (no blur)
		cssTarget: ['chrome100', 'safari15', 'firefox110'],
		chunkSizeWarningLimit: 4096,
	},
	test: {
		environment: 'node',
		include: ['test/**/*.test.ts'],
		setupFiles: ['test/setup.ts'],
	},
});
