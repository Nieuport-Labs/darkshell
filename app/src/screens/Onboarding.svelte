<script lang="ts">
	import { Check, ChevronLeft, Copy, Eye, KeyRound, ShieldCheck, Sparkles } from '@lucide/svelte';
	import Button from '../components/ui/Button.svelte';
	import PinPad from '../components/ui/PinPad.svelte';
	import { isValidMnemonic, newMnemonic, normalizeMnemonic } from '../lib/crypto/account';
	import { createWallet } from '../lib/wallet.svelte';

	type Step = 'welcome' | 'words' | 'verify' | 'import' | 'pin' | 'pin2';
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

	async function confirmPin(pin: string) {
		if (pin !== firstPin) {
			error = 'The PINs do not match. Choose a PIN again.';
			firstPin = '';
			step = 'pin';
			reset++;
			return;
		}
		busy = true;
		try {
			await createWallet(mnemonic, pin);
			mnemonic = firstPin = '';
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
			busy = false;
			reset++;
		}
	}

	const back: Partial<Record<Step, Step>> = { words: 'welcome', verify: 'words', import: 'welcome' };
	function goBack() {
		if (step === 'pin' || step === 'pin2') return go(mode === 'create' ? 'words' : 'import');
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
	{:else}
		<PinPad title="Repeat your PIN" {error} {busy} bind:reset oncomplete={confirmPin} />
	{/if}
</div>
