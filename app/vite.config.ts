import { svelte } from '@sveltejs/vite-plugin-svelte';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
	plugins: [
		svelte(),
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
		chunkSizeWarningLimit: 4096,
	},
	test: {
		environment: 'node',
		include: ['test/**/*.test.ts'],
	},
});
