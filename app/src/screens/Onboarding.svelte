<script lang="ts">
	// Setup, one choice per screen: language and currency first (the rest of
	// setup already speaks the language), then create or restore, how the app
	// looks, the recovery phrase (checked by picking words), the PIN, and the
	// optional extras. A choice is made by selecting it and pressing Continue,
	// never by a single tap that could be a finger landing from the screen before.
	import { Check, ChevronLeft, Eye, Fingerprint, Globe, KeyRound, LayoutGrid, ShieldAlert, ShieldCheck, Sparkles, Wallet } from '@lucide/svelte';
	import { isBech32Address } from 'secret-pay';
	import { wordlist } from '@scure/bip39/wordlists/english.js';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import Button from '../components/ui/Button.svelte';
	import Flag from '../components/ui/Flag.svelte';
	import PinPad from '../components/ui/PinPad.svelte';
	import { isValidMnemonic, newMnemonic, normalizeMnemonic, walletFromMnemonic } from '../lib/crypto/account';
	import { biometricAvailable } from '../lib/crypto/biometric';
	import { i18n, LANGS, setLang, t, type Lang } from '../lib/i18n/index.svelte';
	import { platform } from '../lib/platform';
	import { FIATS, fiat, setFiat, type Fiat } from '../lib/price.svelte';
	import { setTor, torAvailable } from '../lib/tor.svelte';
	import { setSimple } from '../lib/ui.svelte';
	import { createWallet, type SetupChoices } from '../lib/wallet.svelte';

	type Step = 'lang' | 'currency' | 'welcome' | 'style' | 'words' | 'verify' | 'import' | 'pin' | 'pin2' | 'bio' | 'tor' | 'emergency' | 'epin' | 'epin2' | 'safe';
	let step = $state<Step>('lang');
	/** where Back goes */
	let trail: Step[] = [];
	let dir = $state(1);
	let mode = $state<'create' | 'import'>('create');
	let mnemonic = $state('');
	let revealed = $state(false);
	let importText = $state('');
	let firstPin = '';
	let busy = $state(false);
	let error = $state('');
	let reset = $state(0);
	let pin = '';
	let choices = $state<SetupChoices>({});
	let ePin = '';
	let safe = $state('');
	let bioAvailable = $state(false);
	void biometricAvailable().then((v) => (bioAvailable = v));
	const bioName = platform === 'ios' ? 'Face ID' : t('fingerprint');
	const device = platform === 'extension' || platform === 'web' ? t('this browser') : t('this phone');

	const words = $derived(mnemonic ? mnemonic.split(' ') : []);

	// a moment after a screen changes, nothing on it can be pressed: the finger
	// that pressed the last screen's button may still be coming down
	let settling = $state(false);
	let settleTimer: ReturnType<typeof setTimeout> | undefined;

	function go(s: Step, replace = false) {
		error = '';
		if (!replace) trail.push(step);
		dir = 1;
		step = s;
		settling = true;
		clearTimeout(settleTimer);
		settleTimer = setTimeout(() => (settling = false), 450);
	}

	function goBack() {
		const prev = trail.pop();
		if (!prev) return;
		error = '';
		dir = -1;
		if (prev === 'pin2' || prev === 'pin') firstPin = '';
		step = prev === 'pin2' ? 'pin' : prev === 'epin2' ? 'epin' : prev;
		reset++;
	}

	/* language and currency */
	let pickedLang = $state<Lang>(i18n.lang);
	const DEFAULT_FIAT: Record<Lang, Fiat> = { en: 'USD', cs: 'CZK', de: 'EUR' };
	let pickedFiat = $state<Fiat>(fiat.code);
	let fiatTouched = false;

	function pickLang(l: Lang) {
		pickedLang = l;
		void setLang(l);
		if (!fiatTouched) pickedFiat = DEFAULT_FIAT[l];
	}

	// "Hello" in turn, until a language is picked
	const HELLO = ['Hello', 'Ahoj', 'Hallo'];
	let helloAt = $state(0);
	$effect(() => {
		if (step !== 'lang') return;
		const id = setInterval(() => (helloAt = (helloAt + 1) % HELLO.length), 1600);
		return () => clearInterval(id);
	});

	/* how the app looks */
	let pickedStyle = $state<'simple' | 'full' | null>(null);

	/* create / restore */
	function startCreate() {
		mode = 'create';
		mnemonic ||= newMnemonic();
		revealed = false;
		go('style');
	}

	function startImport() {
		mode = 'import';
		go('style');
	}

	function styleChosen() {
		void setSimple(pickedStyle === 'simple');
		go(mode === 'create' ? 'words' : 'import');
	}

	/* the phrase check: pick each asked word among four */
	let checks = $state<number[]>([]);
	let round = $state(0);
	let options = $state<string[]>([]);
	let wrong = $state<string | null>(null);
	let right = $state(false);

	function randomInt(n: number) {
		return crypto.getRandomValues(new Uint32Array(1))[0]! % n;
	}

	function startVerify() {
		const picks = new Set<number>();
		while (picks.size < 3) picks.add(randomInt(words.length));
		checks = [...picks].sort((a, b) => a - b);
		round = 0;
		dealOptions();
		go('verify');
	}

	function dealOptions() {
		const answer = words[checks[round]!]!;
		const set = new Set([answer]);
		while (set.size < 4) {
			const w = wordlist[randomInt(wordlist.length)]!;
			if (!words.includes(w)) set.add(w);
		}
		options = [...set].sort(() => randomInt(3) - 1);
		wrong = null;
		right = false;
	}

	function pickWord(w: string) {
		if (right) return;
		if (w !== words[checks[round]!]) {
			wrong = w;
			navigator.vibrate?.([30, 50, 30]);
			return;
		}
		right = true;
		navigator.vibrate?.(12);
		setTimeout(() => {
			if (round < 2) {
				round++;
				dealOptions();
			} else go('pin');
		}, 550);
	}

	function submitImport(e: SubmitEvent) {
		e.preventDefault();
		if (!isValidMnemonic(importText)) return (error = t('That is not a valid 12 or 24 word recovery phrase.'));
		mnemonic = normalizeMnemonic(importText);
		importText = '';
		go('pin');
	}

	/* PIN */
	function setPin(p: string) {
		firstPin = p;
		go('pin2');
		reset++;
	}

	function confirmPin(p: string) {
		if (p !== firstPin) {
			firstPin = '';
			go('pin', true);
			error = t('The PINs do not match. Choose a PIN again.');
			reset++;
			return;
		}
		pin = p;
		choices = {};
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
			error = t('Choose a PIN different from your normal one.');
			reset++;
			return;
		}
		ePin = p;
		go('epin2');
		reset++;
	}

	function confirmEmergency(p: string) {
		if (p !== ePin) {
			ePin = '';
			go('epin', true);
			error = t('The PINs do not match. Choose the emergency PIN again.');
			reset++;
			return;
		}
		go('safe');
	}

	const ownAddress = $derived(mnemonic ? walletFromMnemonic(mnemonic, 0).address : '');
	const safeError = $derived(safe.trim() && (!isBech32Address(safe.trim(), 'secret') || safe.trim() === ownAddress) ? t('Enter a secret1… address of a different wallet.') : '');

	async function finish(withEmergency: boolean) {
		if (withEmergency && safeError) return;
		if (withEmergency) choices.emergency = { pin: ePin, ...(safe.trim() ? { to: safe.trim() } : {}) };
		// a restored phrase may have more accounts with money on them (e.g. from Keplr)
		choices.discover = mode === 'import';
		busy = true;
		error = '';
		try {
			await createWallet(mnemonic, pin, $state.snapshot(choices));
			mnemonic = firstPin = pin = ePin = '';
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
			busy = false;
			reset++;
		}
	}

	// the bar at the top: where in setup this screen is
	const STAGE: Record<Step, number> = { lang: 0, currency: 1, welcome: 2, style: 3, words: 4, verify: 4, import: 4, pin: 5, pin2: 5, bio: 6, tor: 6, emergency: 6, epin: 6, epin2: 6, safe: 6 };
	const STAGES = 7;
</script>

{#snippet choice(selected: boolean, onclick: () => void, body: import('svelte').Snippet)}
	<button
		type="button"
		{onclick}
		aria-pressed={selected}
		class="card state-layer relative flex items-center gap-4 p-4 text-left transition-[border-color,background-color,transform] duration-200 active:scale-[0.98] {selected ? 'border-accent bg-accent-soft' : ''}"
	>
		{@render body()}
		<span class="ml-auto flex size-6 shrink-0 items-center justify-center rounded-pill border-2 transition-colors {selected ? 'border-accent bg-accent text-white' : 'border-border-strong'}">
			{#if selected}<span class="flex animate-[pop-in_260ms_var(--ease-spring)]"><Check size={14} strokeWidth={3} /></span>{/if}
		</span>
	</button>
{/snippet}

<div class="mx-auto flex w-full max-w-[420px] flex-1 flex-col gap-5 {settling ? 'pointer-events-none' : ''}">
	<div class="flex items-center gap-3">
		<button type="button" onclick={goBack} aria-label={t('Back')} class="state-layer -ml-1.5 rounded-pill p-1.5 text-text-muted {step === 'lang' ? 'invisible' : ''}"><ChevronLeft size={20} /></button>
		<div class="flex flex-1 gap-1.5" aria-hidden="true">
			{#each Array(STAGES) as _, i (i)}
				<span class="h-1 flex-1 overflow-hidden rounded-pill bg-surface-3">
					<span class="block h-full rounded-pill bg-accent transition-transform duration-500 ease-[var(--ease-out-expo)] origin-left {i <= STAGE[step] ? 'scale-x-100' : 'scale-x-0'}"></span>
				</span>
			{/each}
		</div>
		<span class="w-8"></span>
	</div>

	{#key step}
		<div class="flex flex-1 flex-col gap-5" in:fly={{ x: 28 * dir, duration: 320, easing: cubicOut }}>
			{#if step === 'lang'}
				<div class="flex flex-1 flex-col justify-center gap-6">
					<div>
						<span class="halo size-14"><img src="/avatar.webp" alt="" class="size-14 rounded-pill object-cover" /></span>
						<div class="relative mt-6 h-12 overflow-hidden">
							{#key helloAt}
								<h1 class="absolute text-display" in:fly={{ y: 24, duration: 420, easing: cubicOut }} out:fly={{ y: -24, duration: 300 }}>{HELLO[helloAt]}</h1>
							{/key}
						</div>
						<p class="mt-1 text-base text-text-muted">{t('Pick your language.')}</p>
					</div>
					<div class="stagger flex flex-col gap-2.5">
						{#each LANGS as l (l.code)}
							{#snippet body()}
								<Flag lang={l.code} size={32} />
								<span class="text-title">{l.name}</span>
							{/snippet}
							{@render choice(pickedLang === l.code, () => pickLang(l.code), body)}
						{/each}
					</div>
				</div>
				<div class="pb-2"><Button block size="lg" onclick={() => go('currency')}>{t('Continue')}</Button></div>
			{:else if step === 'currency'}
				<div class="flex flex-1 flex-col justify-center gap-6">
					<div>
						<h1 class="text-headline">{t('Your currency')}</h1>
						<p class="mt-1.5 text-base text-text-muted">{t('Balances are also shown in it. You can change it in Settings.')}</p>
					</div>
					<div class="stagger flex flex-col gap-2.5">
						{#each FIATS as f (f.code)}
							{#snippet body()}
								<span class="flex size-12 shrink-0 items-center justify-center rounded-pill bg-surface-3 text-title font-semibold {pickedFiat === f.code ? 'text-accent' : ''}">{f.symbol}</span>
								<span>
									<span class="block text-title">{t(f.name)}</span>
									<span class="block text-label text-text-faint">{f.code}</span>
								</span>
							{/snippet}
							{@render choice(pickedFiat === f.code, () => ((pickedFiat = f.code), (fiatTouched = true)), body)}
						{/each}
					</div>
				</div>
				<div class="pb-2"><Button block size="lg" onclick={() => (void setFiat(pickedFiat), go('welcome'))}>{t('Continue')}</Button></div>
			{:else if step === 'welcome'}
				<div class="flex flex-1 flex-col justify-center">
					<h1 class="text-display">{t('A private account for your SCRT')}</h1>
					<p class="mt-2 text-base text-text-muted">{t('One private balance in sSCRT. Send, receive and pay invoices on Secret Network — network fees are taken care of.')}</p>
					<ul class="stagger mt-6 flex flex-col gap-3 text-base text-text-muted">
						<li class="flex gap-3"><ShieldCheck size={18} class="mt-px shrink-0 text-accent" />{t('Balances and transfers are encrypted on chain.')}</li>
						<li class="flex gap-3"><Sparkles size={18} class="mt-px shrink-0 text-accent" />{t('Pay invoices in any token, even Lightning.')}</li>
						<li class="flex gap-3"><KeyRound size={18} class="mt-px shrink-0 text-accent" />{t('Your keys never leave this device.')}</li>
					</ul>
				</div>
				<div class="flex flex-col gap-2.5 pb-2">
					<Button block size="lg" onclick={startCreate}>{t('Create a new account')}</Button>
					<Button variant="secondary" block size="lg" onclick={startImport}>{t('I have a recovery phrase')}</Button>
				</div>
			{:else if step === 'style'}
				<div class="flex flex-1 flex-col justify-center gap-6">
					<div>
						<h1 class="text-headline">{t('How do you want DarkShell?')}</h1>
						<p class="mt-1.5 text-base text-text-muted">{t('You can switch any time in Settings.')}</p>
					</div>
					<div class="stagger flex flex-col gap-2.5">
						{#snippet simpleBody()}
							<span class="flex size-11 shrink-0 items-center justify-center rounded-pill bg-accent-soft text-accent"><Wallet size={21} /></span>
							<span>
								<span class="block text-title">{t('Simple')}</span>
								<span class="mt-0.5 block text-base text-text-muted">{t('Your balance, Send and Receive. Nothing else on the screen.')}</span>
							</span>
						{/snippet}
						{#snippet fullBody()}
							<span class="flex size-11 shrink-0 items-center justify-center rounded-pill bg-surface-3 text-text"><LayoutGrid size={21} /></span>
							<span>
								<span class="block text-title">{t('Full')}</span>
								<span class="mt-0.5 block text-base text-text-muted">{t('Also invoices, earning by staking, governance votes and recent activity.')}</span>
							</span>
						{/snippet}
						{@render choice(pickedStyle === 'simple', () => (pickedStyle = 'simple'), simpleBody)}
						{@render choice(pickedStyle === 'full', () => (pickedStyle = 'full'), fullBody)}
					</div>
				</div>
				<div class="pb-2"><Button block size="lg" disabled={!pickedStyle} onclick={styleChosen}>{pickedStyle ? t('Continue') : t('Pick one')}</Button></div>
			{:else if step === 'words'}
				<div>
					<h1 class="text-headline">{t('Your recovery phrase')}</h1>
					<p class="mt-1.5 text-base text-text-muted">{t('Write these 24 words down, in order. They are the only way to restore your account, and anyone who has them can take your money. On paper, not in a screenshot or a notes app.')}</p>
				</div>
				<div class="card relative p-4">
					<ol class="grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-sm transition-[filter] duration-700 ease-[var(--ease-out-expo)] {revealed ? '' : 'select-none blur-md'}">
						{#each words as w, i (i)}<li><span class="inline-block w-6 text-right text-text-faint">{i + 1}</span> {w}</li>{/each}
					</ol>
					{#if !revealed}
						<button type="button" onclick={() => (revealed = true)} class="absolute inset-0 flex items-center justify-center gap-2 text-base font-medium">
							<Eye size={16} /> {t('Tap to reveal')}
						</button>
					{/if}
				</div>
				<div class="mt-auto flex flex-col gap-1 pb-2">
					<Button block size="lg" disabled={!revealed} onclick={startVerify}>{t('I wrote them down')}</Button>
					<Button variant="ghost" block disabled={!revealed} onclick={() => go('pin')}>{t('Skip the check')}</Button>
				</div>
			{:else if step === 'verify'}
				<div class="flex flex-1 flex-col justify-center gap-6">
					<div>
						<p class="text-label font-medium uppercase tracking-wide text-accent">{t('Check {n} of 3', { n: round + 1 })}</p>
						<h1 class="mt-2 text-headline">{t('Which is word #{n}?', { n: checks[round]! + 1 })}</h1>
						<p class="mt-1.5 text-base text-text-muted">{t('Look at your paper, not at the screen before.')}</p>
					</div>
					{#key round}
						<div class="stagger grid grid-cols-2 gap-2.5">
							{#each options as w (w)}
								{@const isRight = right && w === words[checks[round]!]}
								<button
									type="button"
									onclick={() => pickWord(w)}
									class="card state-layer flex h-16 items-center justify-center font-mono text-title transition-[border-color,background-color,transform] duration-200 active:scale-95
										{isRight ? 'border-positive text-positive animate-[pop-in_320ms_var(--ease-spring)]' : ''}
										{wrong === w ? 'border-negative text-negative animate-[shake_400ms_var(--ease-standard)]' : ''}"
								>
									{w}{#if isRight}<Check size={18} class="ml-2" />{/if}
								</button>
							{/each}
						</div>
					{/key}
					<p class="min-h-6 text-center text-base {wrong ? 'text-negative' : 'text-text-faint'}">{wrong ? t('Not this one. Try again.') : ''}</p>
				</div>
				<div class="pb-2"><Button variant="ghost" block onclick={() => go('pin')}>{t('Skip the check')}</Button></div>
			{:else if step === 'import'}
				<form class="flex flex-1 flex-col gap-4" onsubmit={submitImport}>
					<div>
						<h1 class="text-headline">{t('Restore an account')}</h1>
						<p class="mt-1.5 text-base text-text-muted">{t('The same phrase works in Keplr, Leap and other Secret wallets. It never leaves this device.')}</p>
					</div>
					<label class="field">
						<span class="text-label text-text-muted">{t('Recovery phrase (12 or 24 words)')}</span>
						<textarea rows="5" bind:value={importText} autocomplete="off" autocapitalize="none" spellcheck="false" class="field-input resize-none font-mono"></textarea>
					</label>
					{#if error}<p class="text-base text-negative" role="alert">{error}</p>{/if}
					<div class="mt-auto pb-2"><Button type="submit" block size="lg">{t('Continue')}</Button></div>
				</form>
			{:else if step === 'pin'}
				<PinPad title={t('Choose a PIN')} subtitle={t('6 digits to unlock DarkShell on this device. It encrypts your recovery phrase.')} {error} bind:reset oncomplete={setPin} />
			{:else if step === 'pin2'}
				<PinPad title={t('Repeat your PIN')} {error} bind:reset oncomplete={confirmPin} />
			{:else if step === 'bio'}
				<div class="flex flex-1 flex-col justify-center">
					<span class="flex size-16 animate-[pop-in_420ms_var(--ease-spring)] items-center justify-center rounded-pill bg-accent-soft text-accent"><Fingerprint size={30} /></span>
					<h1 class="mt-6 text-headline">{t('Unlock with {method}?', { method: bioName })}</h1>
					<p class="mt-2 text-base text-text-muted">{t('Faster than typing the PIN. The PIN still works, and you can change this in Settings.')}</p>
				</div>
				<div class="flex flex-col gap-1 pb-2">
					<Button block size="xl" onclick={() => chooseBio(true)}>{t('Use {method}', { method: bioName })}</Button>
					<Button variant="ghost" block onclick={() => chooseBio(false)}>{t('Not now')}</Button>
				</div>
			{:else if step === 'tor'}
				<div class="flex flex-1 flex-col justify-center">
					<span class="flex size-16 animate-[pop-in_420ms_var(--ease-spring)] items-center justify-center rounded-pill bg-accent-soft text-accent"><Globe size={30} /></span>
					<h1 class="mt-6 text-headline">{t('Connect through Tor?')}</h1>
					<p class="mt-2 text-base text-text-muted">
						{t("Routes all of DarkShell's traffic through the Tor network, so the nodes and services it talks to never see your IP address. It is slower, and connecting takes up to a minute. You can change it in Settings → Advanced.")}
					</p>
				</div>
				<div class="flex flex-col gap-1 pb-2">
					<Button block size="xl" onclick={() => chooseTor(true)}>{t('Use Tor')}</Button>
					<Button variant="ghost" block onclick={() => chooseTor(false)}>{t('Not now')}</Button>
				</div>
			{:else if step === 'emergency'}
				<div class="flex flex-1 flex-col justify-center">
					<span class="flex size-16 animate-[pop-in_420ms_var(--ease-spring)] items-center justify-center rounded-pill bg-accent-soft text-accent"><ShieldAlert size={30} /></span>
					<h1 class="mt-6 text-headline">{t('An emergency PIN')}</h1>
					<p class="mt-2 text-base text-text-muted">{t('For when someone forces you to unlock. Typed instead of your PIN, it:')}</p>
					<ul class="stagger mt-4 flex flex-col gap-2.5 text-base text-text-muted">
						<li class="flex gap-3"><span class="mt-px text-accent">1</span>{t('erases your wallet from {device},', { device })}</li>
						<li class="flex gap-3"><span class="mt-px text-accent">2</span>{t('sends your funds to a safe address, if you set one,')}</li>
						<li class="flex gap-3"><span class="mt-px text-accent">3</span>{t('opens a separate empty wallet, as if nothing happened.')}</li>
					</ul>
					{#if choices.biometric}<p class="mt-4 text-label text-text-faint">{t('It will work with {method} too: the system asks once more now, never when it is used.', { method: bioName })}</p>{/if}
				</div>
				<div class="flex flex-col gap-1 pb-2">
					<Button block size="xl" onclick={() => go('epin')}>{t('Set an emergency PIN')}</Button>
					<Button variant="ghost" block loading={busy} onclick={() => finish(false)}>{t('Skip')}</Button>
					{#if error}<p class="text-center text-base text-negative" role="alert">{error}</p>{/if}
				</div>
			{:else if step === 'epin'}
				<PinPad title={t('Choose an emergency PIN')} subtitle={t('6 digits, different from your PIN.')} {error} bind:reset oncomplete={setEmergency} />
			{:else if step === 'epin2'}
				<PinPad title={t('Repeat the emergency PIN')} {error} bind:reset oncomplete={confirmEmergency} />
			{:else}
				<div class="flex flex-1 flex-col gap-4">
					<div>
						<h1 class="text-headline">{t('Safe address')}</h1>
						<p class="mt-1.5 text-base text-text-muted">
							{t('Optional. When the emergency PIN is used, your funds move here in the background. Use a wallet that is not on {device}. Leave it empty to only erase.', { device })}
						</p>
					</div>
					<input
						bind:value={safe}
						placeholder="secret1…"
						autocomplete="off"
						autocapitalize="none"
						spellcheck="false"
						aria-label={t('Safe address')}
						class="rounded-pill bg-surface px-5 py-3.5 font-mono text-sm outline-none placeholder:text-text-faint"
					/>
					{#if safeError}<p class="px-2 text-base text-negative">{safeError}</p>{/if}
					{#if error}<p class="px-2 text-base text-negative" role="alert">{error}</p>{/if}
					<div class="mt-auto pb-2">
						<Button block size="xl" loading={busy} disabled={!!safeError} onclick={() => finish(true)}>{safe.trim() ? t('Finish') : t('Finish without an address')}</Button>
					</div>
				</div>
			{/if}
		</div>
	{/key}
</div>
