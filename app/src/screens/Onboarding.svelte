<script lang="ts">
	import { Check, ChevronLeft, Copy, Eye, Fingerprint, Globe, KeyRound, LayoutGrid, ShieldAlert, ShieldCheck, Sparkles, Wallet } from '@lucide/svelte';
	import { isBech32Address } from 'secret-pay';
	import Button from '../components/ui/Button.svelte';
	import PinPad from '../components/ui/PinPad.svelte';
	import { isValidMnemonic, newMnemonic, normalizeMnemonic, walletFromMnemonic } from '../lib/crypto/account';
	import { biometricAvailable } from '../lib/crypto/biometric';
	import { setTor, torAvailable } from '../lib/tor.svelte';
	import { setSimple } from '../lib/ui.svelte';
	import { createWallet, type SetupChoices } from '../lib/wallet.svelte';

	type Step = 'welcome' | 'words' | 'verify' | 'import' | 'pin' | 'pin2' | 'style' | 'bio' | 'tor' | 'emergency' | 'epin' | 'epin2' | 'safe';
	let step = $state<Step>('welcome');
	let mode = $state<'create' | 'import'>('create');
	let mnemonic = $state('');
	let revealed = $state(false);
	let copied = $state(false);
	let checks = $state<number[]>([]);
	let answers = $state<string[]>(['', '', '']);
	let importText = $state('');
	let firstPin = '';
	let busy = $state(false);
	let error = $state('');
	let reset = $state(0);
	let pin = '';
	let choices: SetupChoices = {};
	let ePin = '';
	let safe = $state('');
	let bioAvailable = false;
	void biometricAvailable().then((v) => (bioAvailable = v));

	const words = $derived(mnemonic ? mnemonic.split(' ') : []);

	function go(s: Step) {
		error = '';
		step = s;
	}

	function startCreate() {
		mode = 'create';
		mnemonic = newMnemonic();
		revealed = false;
		go('words');
	}

	async function copyAll() {
		try {
			await navigator.clipboard.writeText(mnemonic);
			copied = true;
			// don't leave the seed in the clipboard forever
			setTimeout(() => {
				copied = false;
				void navigator.clipboard.writeText('').catch(() => {});
			}, 60_000);
		} catch {
			/* clipboard blocked */
		}
	}

	function startVerify() {
		const picks = new Set<number>();
		for (const n of crypto.getRandomValues(new Uint32Array(16))) {
			picks.add(n % words.length);
			if (picks.size === 3) break;
		}
		checks = [...picks].sort((a, b) => a - b);
		answers = ['', '', ''];
		go('verify');
	}

	function verify(e: SubmitEvent) {
		e.preventDefault();
		if (!checks.every((i, k) => answers[k]!.trim().toLowerCase() === words[i])) return (error = 'Those words do not match your recovery phrase.');
		go('pin');
	}

	function submitImport(e: SubmitEvent) {
		e.preventDefault();
		if (!isValidMnemonic(importText)) return (error = 'That is not a valid 12 or 24 word recovery phrase.');
		mode = 'import';
		mnemonic = normalizeMnemonic(importText);
		importText = '';
		go('pin');
	}

	function setPin(pin: string) {
		firstPin = pin;
		go('pin2');
		reset++;
	}

	function confirmPin(p: string) {
		if (p !== firstPin) {
			error = 'The PINs do not match. Choose a PIN again.';
			firstPin = '';
			step = 'pin';
			reset++;
			return;
		}
		pin = p;
		choices = {};
		go('style');
	}

	function chooseStyle(simple: boolean) {
		void setSimple(simple);
		go(bioAvailable ? 'bio' : afterBio());
	}

	const afterBio = (): Step => (torAvailable ? 'tor' : 'emergency');

	function chooseBio(on: boolean) {
		choices.biometric = on;
		go(afterBio());
	}

	function chooseTor(on: boolean) {
		// starts right away: nothing on the network happens before the wallet exists
		if (on) void setTor(true);
		go('emergency');
	}

	function setEmergency(p: string) {
		if (p === pin) {
			error = 'Choose a PIN different from your normal one.';
			reset++;
			return;
		}
		ePin = p;
		go('epin2');
		reset++;
	}

	function confirmEmergency(p: string) {
		if (p !== ePin) {
			error = 'The PINs do not match. Choose the emergency PIN again.';
			ePin = '';
			step = 'epin';
			reset++;
			return;
		}
		go('safe');
	}

	const ownAddress = $derived(mnemonic ? walletFromMnemonic(mnemonic, 0).address : '');
	const safeError = $derived(safe.trim() && (!isBech32Address(safe.trim(), 'secret') || safe.trim() === ownAddress) ? 'Enter a secret1… address of a different wallet.' : '');

	async function finish(withEmergency: boolean) {
		if (withEmergency && safeError) return;
		if (withEmergency) choices.emergency = { pin: ePin, ...(safe.trim() ? { to: safe.trim() } : {}) };
		// a restored phrase may have more accounts with money on them (e.g. from Keplr)
		choices.discover = mode === 'import';
		busy = true;
		error = '';
		try {
			await createWallet(mnemonic, pin, choices);
			mnemonic = firstPin = pin = ePin = '';
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
			busy = false;
			reset++;
		}
	}

	const back: Partial<Record<Step, Step>> = { words: 'welcome', verify: 'words', import: 'welcome', epin: 'emergency', epin2: 'epin', safe: 'epin' };
	function goBack() {
		if (step === 'pin' || step === 'pin2') return go(mode === 'create' ? 'words' : 'import');
		if (step === 'style') return go('pin');
		if (step === 'bio') return go('style');
		if (step === 'tor') return go(bioAvailable ? 'bio' : 'style');
		if (step === 'emergency') return go(torAvailable ? 'tor' : bioAvailable ? 'bio' : 'style');
		go(back[step]!);
	}
</script>

<div class="mx-auto flex w-full max-w-[420px] flex-1 flex-col gap-6">
	{#if step !== 'welcome'}
		<button type="button" onclick={goBack} aria-label="Back" class="state-layer -ml-1.5 self-start rounded-pill p-1.5 text-text-muted"><ChevronLeft size={20} /></button>
	{/if}

	{#if step === 'welcome'}
		<div class="flex flex-1 flex-col justify-center">
			<img src="/avatar.webp" alt="" class="size-14 rounded-pill object-cover" />
			<h1 class="mt-6 text-display">A private account for your SCRT</h1>
			<p class="mt-2 text-base text-text-muted">One private balance in sSCRT. Send, receive and pay invoices on Secret Network — network fees are taken care of.</p>
			<ul class="mt-6 flex flex-col gap-3 text-base text-text-muted">
				<li class="flex gap-3"><ShieldCheck size={18} class="mt-px shrink-0 text-accent" />Balances and transfers are encrypted on chain.</li>
				<li class="flex gap-3"><Sparkles size={18} class="mt-px shrink-0 text-accent" />Pay invoices in any token, even Lightning.</li>
				<li class="flex gap-3"><KeyRound size={18} class="mt-px shrink-0 text-accent" />Your keys never leave this device.</li>
			</ul>
		</div>
		<div class="flex flex-col gap-2.5 pb-2">
			<Button block size="lg" onclick={startCreate}>Create a new account</Button>
			<Button variant="secondary" block size="lg" onclick={() => go('import')}>I have a recovery phrase</Button>
		</div>
	{:else if step === 'words'}
		<div>
			<h1 class="text-headline">Your recovery phrase</h1>
			<p class="mt-1.5 text-base text-text-muted">Write these 24 words down, in order. They are the only way to restore your account, and anyone who has them can take your money.</p>
		</div>
		<div class="card relative p-4">
			<ol class="grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-sm {revealed ? '' : 'select-none blur-md'}">
				{#each words as w, i (i)}<li><span class="inline-block w-6 text-right text-text-faint">{i + 1}</span> {w}</li>{/each}
			</ol>
			{#if !revealed}
				<button type="button" onclick={() => (revealed = true)} class="absolute inset-0 flex items-center justify-center gap-2 text-base font-medium">
					<Eye size={16} /> Tap to reveal
				</button>
			{/if}
		</div>
		{#if revealed}
			<Button variant="secondary" shape="control" class="-mt-3 self-start" onclick={copyAll}>
				{#snippet icon()}{#if copied}<Check size={16} class="text-positive" />{:else}<Copy size={16} />{/if}{/snippet}
				{copied ? 'Copied — clears in 1 min' : 'Copy all 24 words'}
			</Button>
		{/if}
		<div class="mt-auto flex flex-col gap-1 pb-2">
			<Button block size="lg" disabled={!revealed} onclick={startVerify}>I wrote them down</Button>
			<Button variant="ghost" block disabled={!revealed} onclick={() => go('pin')}>Skip the check</Button>
		</div>
	{:else if step === 'verify'}
		<form class="flex flex-1 flex-col gap-4" onsubmit={verify}>
			<div>
				<h1 class="text-headline">Check your backup</h1>
				<p class="mt-1.5 text-base text-text-muted">Type these words from your backup.</p>
			</div>
			{#each checks as idx, k (idx)}
				<label class="field">
					<span class="text-label text-text-muted">Word #{idx + 1}</span>
					<input bind:value={answers[k]} autocomplete="off" autocapitalize="none" spellcheck="false" class="field-input font-mono" />
				</label>
			{/each}
			{#if error}<p class="text-base text-negative" role="alert">{error}</p>{/if}
			<div class="mt-auto flex flex-col gap-1 pb-2">
				<Button type="submit" block size="lg">Continue</Button>
				<Button variant="ghost" block onclick={() => go('pin')}>Skip the check</Button>
			</div>
		</form>
	{:else if step === 'import'}
		<form class="flex flex-1 flex-col gap-4" onsubmit={submitImport}>
			<div>
				<h1 class="text-headline">Restore an account</h1>
				<p class="mt-1.5 text-base text-text-muted">The same phrase works in Keplr, Leap and other Secret wallets. It never leaves this device.</p>
			</div>
			<label class="field">
				<span class="text-label text-text-muted">Recovery phrase (12 or 24 words)</span>
				<textarea rows="5" bind:value={importText} autocomplete="off" autocapitalize="none" spellcheck="false" class="field-input resize-none font-mono"></textarea>
			</label>
			{#if error}<p class="text-base text-negative" role="alert">{error}</p>{/if}
			<div class="mt-auto pb-2"><Button type="submit" block size="lg">Continue</Button></div>
		</form>
	{:else if step === 'pin'}
		<PinPad title="Choose a PIN" subtitle="6 digits to unlock DarkShell on this device. It encrypts your recovery phrase." {error} bind:reset oncomplete={setPin} />
	{:else if step === 'pin2'}
		<PinPad title="Repeat your PIN" {error} bind:reset oncomplete={confirmPin} />
	{:else if step === 'style'}
		<div class="flex flex-1 flex-col justify-center gap-3">
			<h1 class="text-headline">How do you want DarkShell?</h1>
			<p class="text-base text-text-muted">You can switch any time in Settings.</p>
			<button type="button" onclick={() => chooseStyle(true)} class="card state-layer mt-3 flex items-start gap-4 p-4 text-left">
				<span class="flex size-11 shrink-0 items-center justify-center rounded-pill bg-accent-soft text-accent"><Wallet size={21} /></span>
				<span>
					<span class="block text-title">Simple</span>
					<span class="mt-0.5 block text-base text-text-muted">Your balance, Send and Receive. Nothing else on the screen.</span>
				</span>
			</button>
			<button type="button" onclick={() => chooseStyle(false)} class="card state-layer flex items-start gap-4 p-4 text-left">
				<span class="flex size-11 shrink-0 items-center justify-center rounded-pill bg-surface-3 text-text"><LayoutGrid size={21} /></span>
				<span>
					<span class="block text-title">Full</span>
					<span class="mt-0.5 block text-base text-text-muted">Also invoices, earning by staking, governance votes and recent activity.</span>
				</span>
			</button>
		</div>
	{:else if step === 'bio'}
		<div class="flex flex-1 flex-col justify-center">
			<span class="flex size-14 items-center justify-center rounded-pill bg-accent-soft text-accent"><Fingerprint size={26} /></span>
			<h1 class="mt-6 text-headline">Unlock with your fingerprint?</h1>
			<p class="mt-2 text-base text-text-muted">Faster than typing the PIN. The PIN still works, and you can change this in Settings.</p>
		</div>
		<div class="flex flex-col gap-1 pb-2">
			<Button block size="xl" onclick={() => chooseBio(true)}>Use fingerprint</Button>
			<Button variant="ghost" block onclick={() => chooseBio(false)}>Not now</Button>
		</div>
	{:else if step === 'tor'}
		<div class="flex flex-1 flex-col justify-center">
			<span class="flex size-14 items-center justify-center rounded-pill bg-accent-soft text-accent"><Globe size={26} /></span>
			<h1 class="mt-6 text-headline">Connect through Tor?</h1>
			<p class="mt-2 text-base text-text-muted">
				Routes all of DarkShell's traffic through the Tor network, so the nodes and services it talks to never see your IP address. It is slower, and connecting takes up to a minute. You can change it in Settings → Network.
			</p>
		</div>
		<div class="flex flex-col gap-1 pb-2">
			<Button block size="xl" onclick={() => chooseTor(true)}>Use Tor</Button>
			<Button variant="ghost" block onclick={() => chooseTor(false)}>Not now</Button>
		</div>
	{:else if step === 'emergency'}
		<div class="flex flex-1 flex-col justify-center">
			<span class="flex size-14 items-center justify-center rounded-pill bg-accent-soft text-accent"><ShieldAlert size={26} /></span>
			<h1 class="mt-6 text-headline">An emergency PIN</h1>
			<p class="mt-2 text-base text-text-muted">For when someone forces you to unlock. Typed instead of your PIN, it:</p>
			<ul class="mt-4 flex flex-col gap-2.5 text-base text-text-muted">
				<li class="flex gap-3"><span class="mt-px text-accent">1</span>erases your wallet from this phone,</li>
				<li class="flex gap-3"><span class="mt-px text-accent">2</span>sends your funds to a safe address, if you set one,</li>
				<li class="flex gap-3"><span class="mt-px text-accent">3</span>opens a separate empty wallet, as if nothing happened.</li>
			</ul>
		</div>
		<div class="flex flex-col gap-1 pb-2">
			<Button block size="xl" onclick={() => go('epin')}>Set an emergency PIN</Button>
			<Button variant="ghost" block loading={busy} onclick={() => finish(false)}>Skip</Button>
			{#if error}<p class="text-center text-base text-negative" role="alert">{error}</p>{/if}
		</div>
	{:else if step === 'epin'}
		<PinPad title="Choose an emergency PIN" subtitle="6 digits, different from your PIN." {error} bind:reset oncomplete={setEmergency} />
	{:else if step === 'epin2'}
		<PinPad title="Repeat the emergency PIN" {error} bind:reset oncomplete={confirmEmergency} />
	{:else}
		<div class="flex flex-1 flex-col gap-4">
			<div>
				<h1 class="text-headline">Safe address</h1>
				<p class="mt-1.5 text-base text-text-muted">
					Optional. When the emergency PIN is used, your funds move here in the background. Use a wallet that is not on this phone. Leave it empty to only erase.
				</p>
			</div>
			<input
				bind:value={safe}
				placeholder="secret1…"
				autocomplete="off"
				autocapitalize="none"
				spellcheck="false"
				aria-label="Safe address"
				class="rounded-pill bg-surface px-5 py-3.5 font-mono text-sm outline-none placeholder:text-text-faint"
			/>
			{#if safeError}<p class="px-2 text-base text-negative">{safeError}</p>{/if}
			{#if error}<p class="px-2 text-base text-negative" role="alert">{error}</p>{/if}
			<div class="mt-auto pb-2">
				<Button block size="xl" loading={busy} disabled={!!safeError} onclick={() => finish(true)}>{safe.trim() ? 'Finish' : 'Finish without an address'}</Button>
			</div>
		</div>
	{/if}
</div>
