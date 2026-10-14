<script lang="ts">
	// The extension's approval window. The background sends the requests a site
	// made that need the user; this window unlocks the wallet for them (the PIN,
	// unless the wallet was used within the idle time), shows each one in full
	// and answers. It closes when
	// nothing is left. The sheet word shows it is DarkShell's own window.
	import { Globe, Loader2 } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import DappRequestSheet from '../components/dapp/DappRequestSheet.svelte';
	import Button from '../components/ui/Button.svelte';
	import PinPad from '../components/ui/PinPad.svelte';
	import { WrongPasswordError } from '../lib/crypto/vault';
	import { dappUi, rejectAll, walletHost } from '../lib/dapp/host.svelte';
	import { siteName } from '../lib/dapp/permissions';
	import { handleDappRequest } from '../lib/dapp/provider';
	import type { DappRequest, DappResponse } from '../lib/dapp/protocol';
	import { sheetWord } from '../lib/sheetWord';
	import { init, LockedOutError, unlock, wallet } from '../lib/wallet.svelte';
	import { startSync, syncSession } from './sync';
	import { resume, watchIdle } from './unlock';

	let word = $state<string | null>(null);
	let origin = $state('');
	let pinError = $state('');
	let pinReset = $state(0);
	let busy = $state(false);
	let password = $state('');
	let idle = $state(false);

	let port: chrome.runtime.Port;
	const inbox: { origin: string; req: DappRequest }[] = [];
	let working = false;

	async function work(): Promise<void> {
		if (working || wallet.phase !== 'unlocked') return;
		working = true;
		try {
			for (let job = inbox.shift(); job; job = inbox.shift()) {
				origin = job.origin;
				const res: DappResponse = await handleDappRequest(walletHost, job.origin, job.req);
				port.postMessage({ type: 'response', res });
				await syncSession();
			}
		} finally {
			working = false;
		}
	}

	onMount(() => {
		startSync();
		watchIdle();
		void sheetWord().then((w) => (word = w));
		// unlocked a moment ago (within the idle time): no PIN
		void resume().then((ok) => (ok ? void work() : init()));
		port = chrome.runtime.connect({ name: 'approve' });
		port.onMessage.addListener((msg: { type: string; origin?: string; req?: DappRequest }) => {
			if (msg.type === 'request' && msg.origin && msg.req) {
				idle = false;
				inbox.push({ origin: msg.origin, req: msg.req });
				if (!origin) origin = msg.origin;
				void work();
			} else if (msg.type === 'idle') {
				idle = true;
				// a site often asks again right away (connect, then a permit): wait a moment
				setTimeout(() => idle && window.close(), 600);
			}
		});
		port.onDisconnect.addListener(() => window.close());
		port.postMessage({ type: 'ready' });
		return () => rejectAll();
	});

	async function open(secret: string) {
		if (busy) return;
		busy = true;
		pinError = '';
		try {
			await unlock(secret, { brief: true });
			await syncSession();
			void work();
		} catch (e) {
			pinError = e instanceof LockedOutError ? e.message : e instanceof WrongPasswordError ? (wallet.kind === 'pin' ? 'Wrong PIN.' : 'Wrong password.') : e instanceof Error ? e.message : String(e);
			pinReset++;
		} finally {
			busy = false;
		}
	}

	function setUp() {
		void chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
		window.close();
	}
</script>

<div class="relative mx-auto flex min-h-[100dvh] w-full max-w-[460px] flex-col px-4 pb-4 pt-4">
	{#if word}
		<div class="mx-auto mb-2 rounded-pill border border-border bg-surface-1 px-3 py-1 text-label text-text-muted">{word}</div>
	{/if}

	{#if wallet.phase === 'loading' || (!origin && wallet.phase !== 'onboarding')}
		<div class="flex flex-1 items-center justify-center text-text-faint"><Loader2 class="animate-spin" size={28} /></div>
	{:else if wallet.phase === 'onboarding'}
		<div class="flex flex-1 flex-col items-center justify-center gap-4 text-center">
			<p class="text-title">DarkShell isn’t set up yet</p>
			<p class="text-base text-text-muted">Create or restore your wallet first, then connect {siteName(origin)} again.</p>
			<Button size="lg" onclick={setUp}>Set up DarkShell</Button>
		</div>
	{:else if wallet.phase === 'locked'}
		<div class="flex items-center justify-center gap-2 pt-2 text-base text-text-muted">
			<Globe size={16} />
			<span class="break-all">{siteName(origin)}</span>
		</div>
		{#if wallet.kind === 'pin'}
			<PinPad title="Enter your PIN" subtitle={word ? `Check the word above: ${word}` : 'to answer this site'} error={pinError} {busy} bind:reset={pinReset} oncomplete={open} />
		{:else}
			<form class="flex flex-1 flex-col justify-center gap-3" onsubmit={(e) => (e.preventDefault(), open(password))}>
				<input type="password" bind:value={password} autocomplete="current-password" placeholder="Password" class="rounded-control border border-border bg-surface-1 px-4 py-3 text-base" />
				{#if pinError}<p class="text-base text-negative">{pinError}</p>{/if}
				<Button type="submit" size="lg" loading={busy}>Unlock</Button>
			</form>
		{/if}
		<div class="pt-2">
			<Button variant="secondary" block onclick={() => window.close()}>Reject</Button>
		</div>
	{:else if dappUi.pending}
		{#key dappUi.pending.id}<DappRequestSheet item={dappUi.pending} />{/key}
	{:else}
		<div class="flex flex-1 items-center justify-center text-text-faint"><Loader2 class="animate-spin" size={28} /></div>
	{/if}
</div>
