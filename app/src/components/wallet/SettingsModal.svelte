<script lang="ts">
	import PageHeader from '../ui/PageHeader.svelte';
	import { Bell, Check, ChevronDown, Copy, Fingerprint, Fuel, Globe, KeyRound, Lock, ShieldAlert, Users, Zap } from '@lucide/svelte';
	import { biometricAvailable, biometricEnabled } from '../../lib/crypto/biometric';
	import { allowBackground, backgroundUnrestricted, canNotify } from '../../lib/notify/background';
	import { isBech32Address } from 'secret-pay';
	import type { Snippet } from 'svelte';
	import { resetEndpoint } from '../../lib/chain/client';
	import type { TxOutcome } from '../../lib/chain/tx';
	import { CREDIT_FLOOR, CREDIT_REFILL, GAS_VAULT_ADDRESS } from '../../lib/config';
	import { WrongPasswordError } from '../../lib/crypto/vault';
	import { builtInFf } from '../../lib/ff/fixedfloat';
	import { formatAmount, shortAddress } from '../../lib/format';
	import { kv } from '../../lib/storage';
	import { close, open } from '../../lib/ui.svelte';
	import {
		activeName,
		changePin,
		emergencyPin,
		ffCredentials,
		forgetDevice,
		LockedOutError,
		lock,
		notificationsInBackground,
		refillNow,
		removeEmergencyPin,
		revealMnemonic,
		setBiometric,
		setEmergencyPin,
		setFfCredentials,
		setNotificationsInBackground,
		wallet,
	} from '../../lib/wallet.svelte';
	import Button from '../ui/Button.svelte';
	import Modal from '../ui/Modal.svelte';
	import PoweredByFF from './PoweredByFF.svelte';
	import TxResult from './TxResult.svelte';

	/** rendered as the Settings tab instead of a dialog */
	let { page = false }: { page?: boolean } = $props();

	let openSection = $state<'gas' | 'phrase' | 'password' | 'network' | 'ff' | 'bio' | 'notify' | 'emergency' | null>('gas');

	/* fingerprint */
	let bioAvailable = $state(false);
	let bioOn = $state(false);
	let bioPin = $state('');
	let bioAsk = $state(false);
	let bioMsg = $state('');
	void biometricAvailable().then((v) => (bioAvailable = v));
	void biometricEnabled().then((v) => (bioOn = v));

	async function bioToggle() {
		bioMsg = '';
		if (bioOn) {
			await setBiometric(false);
			bioOn = false;
			return;
		}
		bioAsk = true;
	}

	async function bioSave(e: SubmitEvent) {
		e.preventDefault();
		bioMsg = '';
		try {
			await setBiometric(true, bioPin);
			bioOn = true;
			bioAsk = false;
			bioMsg = 'Fingerprint unlock is on.';
		} catch (err) {
			bioMsg = err instanceof WrongPasswordError ? 'Wrong PIN.' : 'Fingerprint was not confirmed. Nothing changed.';
		} finally {
			bioPin = '';
		}
	}

	/* notifications */
	let bgOn = $state(false);
	let bgMsg = $state('');
	let bgOk = $state(true);
	let bgUnrestricted = $state(true);
	void notificationsInBackground().then((v) => (bgOn = v));
	void backgroundUnrestricted().then((v) => (bgUnrestricted = v));

	async function bgToggle() {
		bgMsg = '';
		const want = !bgOn;
		try {
			const got = await setNotificationsInBackground(want);
			bgOn = got;
			bgOk = !(want && !got);
			if (want && !got) bgMsg = 'Notifications are not allowed for DarkShell. Allow them in Android settings and try again.';
			else if (got) bgMsg = 'On. You will get a phone notification for incoming payments.';
		} catch (e) {
			bgOn = true;
			bgOk = false;
			bgMsg = e instanceof Error ? e.message : String(e);
		}
	}

	/* emergency PIN */
	let em = $state(emergencyPin());
	let emEdit = $state(false);
	let emAction = $state<'wipe' | 'sweep'>('wipe');
	let emTo = $state('');
	let emPin = $state('');
	let emCurrent = $state('');
	let emMsg = $state('');
	let emBusy = $state(false);
	const emToValid = $derived(isBech32Address(emTo.trim(), 'secret') && !wallet.accounts.some((a) => a.address === emTo.trim()));

	async function emSave(e: SubmitEvent) {
		e.preventDefault();
		emMsg = '';
		if (emAction === 'sweep' && !emToValid) return (emMsg = 'Enter a secret1… address that is not one of your accounts here.');
		if (!/^[0-9]{6}$/.test(emPin)) return (emMsg = 'The emergency PIN must be exactly 6 digits.');
		emBusy = true;
		try {
			await setEmergencyPin(emCurrent, emPin, emAction, emAction === 'sweep' ? emTo.trim() : undefined);
			em = emergencyPin();
			emEdit = false;
			emPin = emCurrent = '';
			emMsg = 'Emergency PIN saved.';
		} catch (err) {
			emMsg = err instanceof WrongPasswordError ? `Your current ${secretName} is wrong.` : err instanceof Error ? err.message : String(err);
		} finally {
			emBusy = false;
		}
	}

	async function emRemove() {
		await removeEmergencyPin();
		em = null;
		emMsg = 'Emergency PIN removed.';
	}
	let refilling = $state(false);
	let refillOutcome = $state<TxOutcome | null>(null);
	let refillError = $state('');

	let revealPw = $state('');
	let phrase = $state('');
	let revealError = $state('');
	let oldPw = $state('');
	let newPw = $state('');
	let pwMsg = $state('');
	let phraseCopied = $state(false);

	const own = ffCredentials();
	let ffKey = $state(own?.key ?? '');
	let ffSecret = $state(own?.secret ?? '');
	let ffMsg = $state('');

	async function saveFf(e: SubmitEvent) {
		e.preventDefault();
		await setFfCredentials(ffKey.trim() && ffSecret.trim() ? { key: ffKey.trim(), secret: ffSecret.trim() } : undefined);
		ffMsg = ffKey.trim() ? 'Saved. Your own key is used from now on.' : builtInFf() ? 'Removed. The built-in key is used.' : 'Removed.';
	}

	async function copyPhrase() {
		await navigator.clipboard.writeText(phrase).catch(() => {});
		phraseCopied = true;
		setTimeout(() => {
			phraseCopied = false;
			void navigator.clipboard.writeText('').catch(() => {});
		}, 60_000);
	}

	const secretName = $derived(wallet.kind === 'pin' ? 'PIN' : 'password');
	let lcd = $state('');
	let confirmRemove = $state(false);
	kv.get<string>('settings.lcd').then((v) => (lcd = v ?? ''));

	const c = $derived(wallet.credits);
	const stateText = $derived(
		!c
			? 'Checking…'
			: {
					warm: 'Healthy. Network fees are paid from your gas credits.',
					low: `Below ${formatAmount(CREDIT_FLOOR)} SCRT. DarkShell is adding ${formatAmount(CREDIT_REFILL)} SCRT automatically.`,
					cold: 'Empty. The first top-up needs a little public SCRT (see below).',
					unknown: 'Could not be read right now. Nothing is lost.',
				}[c.state],
	);

	async function refill() {
		refilling = true;
		refillError = '';
		try {
			refillOutcome = await refillNow();
		} catch (e) {
			refillError = e instanceof Error ? e.message : String(e);
		} finally {
			refilling = false;
		}
	}

	async function reveal(e: SubmitEvent) {
		e.preventDefault();
		revealError = '';
		try {
			phrase = await revealMnemonic(revealPw);
			revealPw = '';
		} catch (err) {
			revealError = err instanceof WrongPasswordError ? `Wrong ${secretName}.` : err instanceof LockedOutError ? err.message : String(err);
		}
	}

	async function change(e: SubmitEvent) {
		e.preventDefault();
		if (!/^[0-9]{6}$/.test(newPw)) return (pwMsg = 'The new PIN must be exactly 6 digits.');
		try {
			await changePin(oldPw, newPw);
			pwMsg = 'PIN changed.';
			oldPw = newPw = '';
		} catch (err) {
			pwMsg = err instanceof WrongPasswordError ? `The current ${secretName} is wrong.` : err instanceof Error ? err.message : String(err);
		}
	}

	async function saveLcd(e: SubmitEvent) {
		e.preventDefault();
		if (lcd.trim()) await kv.set('settings.lcd', lcd.trim());
		else await kv.del('settings.lcd');
		resetEndpoint();
		location.reload();
	}
</script>

{#snippet section(key: typeof openSection, title: string, Icon: typeof Fuel, body: Snippet)}
	<div class="card">
		<button type="button" class="state-layer flex w-full items-center gap-3 rounded-card px-4 py-3 text-left" onclick={() => (openSection = openSection === key ? null : key)} aria-expanded={openSection === key}>
			<Icon size={16} class="text-accent" />
			<span class="flex-1 text-base font-medium">{title}</span>
			<ChevronDown size={16} class="text-text-muted transition-transform {openSection === key ? 'rotate-180' : ''}" />
		</button>
		{#if openSection === key}<div class="flex flex-col gap-3 px-4 pb-4">{@render body()}</div>{/if}
	</div>
{/snippet}

{#snippet toggle(on: boolean, label: string, onclick: () => void)}
	<button type="button" role="switch" aria-checked={on} aria-label={label} {onclick} class="flex w-full items-center gap-3 text-left">
		<span class="flex-1 text-base">{label}</span>
		<span class="relative h-6 w-10 shrink-0 rounded-pill transition-colors duration-200 {on ? 'bg-accent-strong' : 'bg-surface-3'}">
			<span class="absolute top-0.5 size-5 rounded-pill bg-white shadow transition-transform duration-200 [transition-timing-function:var(--ease-emphasised)] {on ? 'translate-x-[1.125rem]' : 'translate-x-0.5'}"></span>
		</span>
	</button>
{/snippet}

{#snippet bioBody()}
	{@render toggle(bioOn, 'Unlock with fingerprint', bioToggle)}
	<p class="text-label text-text-faint">
		Your PIN is kept in the phone's secure hardware and released only after a fingerprint check. Adding or removing a fingerprint on the phone switches this off.
	</p>
	{#if bioAsk && !bioOn}
		<form class="flex flex-col gap-2" onsubmit={bioSave}>
			<input type="password" class="rounded-control border border-border bg-surface px-3 py-2.5 text-base outline-none" placeholder="Your PIN" inputmode="numeric" maxlength="6" autocomplete="current-password" bind:value={bioPin} />
			<Button type="submit" variant="secondary" shape="control">Confirm with fingerprint</Button>
		</form>
	{/if}
	{#if bioMsg}<p class="text-label text-text-muted">{bioMsg}</p>{/if}
{/snippet}

{#snippet notifyBody()}
	<p class="text-label text-text-faint">
		While DarkShell is open, every incoming sSCRT payment shows up within seconds, and an open invoice turns paid by itself. It uses SNIP-52 private notifications: the
		app reads public sSCRT transactions and recognises its own with a key only you and the sSCRT contract know. No server learns which payments are yours.
	</p>
	{#if canNotify}
		{@render toggle(bgOn, 'Also when the app is closed', bgToggle)}
		<p class="text-label text-text-faint">
			Within seconds of the block, like a chat app. DarkShell keeps one quiet connection open and the phone sleeps until an sSCRT payment appears;
			Android shows a small silent “Watching for payments” notice while it runs. The notification keys are kept on the phone unencrypted — they can
			only recognise incoming payments, never spend.
		</p>
		{#if bgOn && !bgUnrestricted}
			<Button variant="secondary" shape="control" onclick={() => allowBackground().then(() => setTimeout(() => backgroundUnrestricted().then((v) => (bgUnrestricted = v)), 4000))}>
				Let it run without battery limits
			</Button>
			<p class="-mt-1 text-label text-text-faint">Some phones stop background apps to save battery; this keeps notifications on time.</p>
		{/if}
		{#if bgMsg}<p class="text-label {bgOk ? 'text-text-muted' : 'text-negative'}">{bgMsg}</p>{/if}
	{/if}
{/snippet}

{#snippet emergencyBody()}
	<p class="text-label text-text-faint">
		A second PIN for when someone forces you to unlock. Entered on the lock screen, it opens the app as usual, but first does what you choose here.
	</p>
	{#if em && !emEdit}
		<div class="rounded-control bg-surface px-3 py-2.5 text-base">
			{#if em.action === 'wipe'}
				<span class="font-medium">Erases this wallet</span> from the phone. The app then looks freshly installed.
			{:else}
				<span class="font-medium">Sends everything</span> to <span class="font-mono text-sm">{shortAddress(em.to ?? '', 10, 6)}</span>, then opens the emptied wallet.
			{/if}
		</div>
		<div class="flex gap-2">
			<Button variant="secondary" shape="control" onclick={() => ((emEdit = true), (emAction = em!.action), (emTo = em!.to ?? ''))}>Change</Button>
			<Button variant="ghost" shape="control" onclick={emRemove}>Remove</Button>
		</div>
	{:else}
		<form class="flex flex-col gap-2" onsubmit={emSave}>
			<div class="grid gap-2" role="radiogroup" aria-label="What the emergency PIN does">
				{#each [['wipe', 'Erase the wallet', 'Removes the recovery phrase and everything else from this phone. Only your written-down phrase brings it back.'], ['sweep', 'Send everything away', 'Moves all sSCRT and SCRT from every account to a safe address of yours, then shows the empty wallet.']] as [k, t, d] (k)}
					<button
						type="button"
						role="radio"
						aria-checked={emAction === k}
						onclick={() => (emAction = k as 'wipe' | 'sweep')}
						class="rounded-control border px-3 py-2.5 text-left transition-colors {emAction === k ? 'border-accent bg-accent-container' : 'border-border bg-surface'}"
					>
						<span class="block text-base font-medium">{t}</span>
						<span class="block text-label text-text-muted">{d}</span>
					</button>
				{/each}
			</div>
			{#if emAction === 'sweep'}
				<input class="rounded-control border border-border bg-surface px-3 py-2.5 font-mono text-sm outline-none" placeholder="Safe address (secret1…)" autocomplete="off" spellcheck="false" bind:value={emTo} />
				<p class="text-label text-text-faint">
					Use a wallet that is not on this phone (a hardware wallet, or one at home). Fees come from your gas credits, so keep them topped up. After it has been used,
					treat this recovery phrase as known to the other person.
				</p>
			{/if}
			<input type="password" class="rounded-control border border-border bg-surface px-3 py-2.5 text-base outline-none" placeholder="New emergency PIN (6 digits)" inputmode="numeric" maxlength="6" autocomplete="off" bind:value={emPin} />
			<input type="password" class="rounded-control border border-border bg-surface px-3 py-2.5 text-base outline-none" placeholder={`Your normal ${secretName}`} inputmode={wallet.kind === 'pin' ? 'numeric' : 'text'} autocomplete="current-password" bind:value={emCurrent} />
			<div class="flex gap-2">
				<Button type="submit" variant="secondary" shape="control" loading={emBusy}>Save emergency PIN</Button>
				{#if emEdit}<Button variant="ghost" shape="control" onclick={() => (emEdit = false)}>Cancel</Button>{/if}
			</div>
		</form>
	{/if}
	{#if emMsg}<p class="text-label text-text-muted">{emMsg}</p>{/if}
{/snippet}

{#snippet gas()}
	{#if refillOutcome}
		<TxResult outcome={refillOutcome} summary="Gas credits refilled with {formatAmount(refillOutcome.refilled)} sSCRT." ondone={() => (refillOutcome = null)} />
	{:else}
		<p class="text-base text-text-muted">{stateText}</p>
		<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-base">
			<dt class="text-text-faint">Credits left</dt>
			<dd class="text-right tabular-nums">{c?.remaining != null ? `${formatAmount(c.remaining)} SCRT` : '—'}</dd>
			<dt class="text-text-faint">Public SCRT</dt>
			<dd class="text-right tabular-nums">{formatAmount(wallet.native)} SCRT</dd>
			<dt class="text-text-faint">Vault</dt>
			<dd class="text-right font-mono text-sm">{shortAddress(GAS_VAULT_ADDRESS, 10, 6)}</dd>
		</dl>
		<p class="text-label text-text-faint">
			Fees are paid from prepaid gas credits, a fee grant from the gas vault, so you never need SCRT. They are kept between {formatAmount(CREDIT_FLOOR)} and {formatAmount(
				CREDIT_FLOOR + CREDIT_REFILL,
			)} SCRT: below {formatAmount(CREDIT_FLOOR)}, {formatAmount(CREDIT_REFILL)} are added from public SCRT you make private, or from sSCRT — with your next payment, or on their own when nothing else is being sent.
		</p>
		{#if c?.state === 'cold'}
			<p class="text-label text-text-faint">
				<strong class="text-text-muted">First top-up:</strong> send about 0.2 public SCRT to your address; it pays the fee of the first refill. Or have someone buy credits for your address at the vault.
			</p>
		{/if}
		{#if refillError}<p class="text-base text-negative">{refillError}</p>{/if}
		<Button variant="soft" shape="control" loading={refilling} onclick={refill}>Refill {formatAmount(CREDIT_REFILL)} sSCRT now</Button>
	{/if}
{/snippet}

{#snippet phraseBody()}
	{#if phrase}
		<ol class="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-sm">
			{#each phrase.split(' ') as w, i (i)}<li><span class="inline-block w-6 text-right text-text-faint">{i + 1}</span> {w}</li>{/each}
		</ol>
		<div class="flex flex-wrap gap-2">
			<Button variant="secondary" shape="control" onclick={copyPhrase}>
				{#snippet icon()}{#if phraseCopied}<Check size={16} class="text-positive" />{:else}<Copy size={16} />{/if}{/snippet}
				{phraseCopied ? 'Copied — clears in 1 min' : 'Copy all'}
			</Button>
			<Button variant="secondary" shape="control" onclick={() => (phrase = '')}>Hide</Button>
		</div>
	{:else}
		<form class="flex flex-col gap-2" onsubmit={reveal}>
			<input type="password" class="rounded-control border border-border bg-surface px-3 py-2.5 text-base outline-none" placeholder={wallet.kind === 'pin' ? 'PIN' : 'Password'} inputmode={wallet.kind === 'pin' ? 'numeric' : 'text'} autocomplete="current-password" bind:value={revealPw} />
			{#if revealError}<p class="text-label text-negative">{revealError}</p>{/if}
			<Button type="submit" variant="secondary" shape="control">Show recovery phrase</Button>
		</form>
	{/if}
{/snippet}

{#snippet passwordBody()}
	<form class="flex flex-col gap-2" onsubmit={change}>
		<input type="password" class="rounded-control border border-border bg-surface px-3 py-2.5 text-base outline-none" placeholder={wallet.kind === 'pin' ? 'Current PIN' : 'Current password'} inputmode={wallet.kind === 'pin' ? 'numeric' : 'text'} autocomplete="current-password" bind:value={oldPw} />
		<input type="password" class="rounded-control border border-border bg-surface px-3 py-2.5 text-base outline-none" placeholder="New 6-digit PIN" inputmode="numeric" maxlength="6" autocomplete="new-password" bind:value={newPw} />
		{#if pwMsg}<p class="text-label text-text-muted">{pwMsg}</p>{/if}
		<Button type="submit" variant="secondary" shape="control">{wallet.kind === 'pin' ? 'Change PIN' : 'Switch to a PIN'}</Button>
	</form>
{/snippet}

{#snippet networkBody()}
	<form class="flex flex-col gap-2" onsubmit={saveLcd}>
		<p class="text-label text-text-faint">Secret Network mainnet (secret-4). Optionally use your own LCD endpoint.</p>
		<input class="rounded-control border border-border bg-surface px-3 py-2.5 font-mono text-sm outline-none" placeholder="https://…" bind:value={lcd} />
		<Button type="submit" variant="secondary" shape="control">Save</Button>
	</form>
{/snippet}

{#snippet ffBody()}
	<form class="flex flex-col gap-2" onsubmit={saveFf}>
		<p class="text-label text-text-faint">
			Lightning invoices are paid through FixedFloat (ff.io). {builtInFf() ? 'This build has a key built in; you can use your own instead.' : 'Add your FixedFloat API key to enable it.'} Your key is stored encrypted with your recovery phrase.
		</p>
		<input class="rounded-control border border-border bg-surface px-3 py-2.5 font-mono text-sm outline-none" placeholder="API key" autocomplete="off" spellcheck="false" bind:value={ffKey} />
		<input type="password" class="rounded-control border border-border bg-surface px-3 py-2.5 font-mono text-sm outline-none" placeholder="API secret" autocomplete="off" bind:value={ffSecret} />
		{#if ffMsg}<p class="text-label text-text-muted">{ffMsg}</p>{/if}
		<Button type="submit" variant="secondary" shape="control">Save</Button>
		<PoweredByFF />
	</form>
{/snippet}

{#snippet content()}
	<button type="button" onclick={() => open({ name: 'accounts' })} class="card state-layer flex w-full items-center gap-3 px-4 py-3 text-left">
		<Users size={16} class="text-accent" />
		<span class="flex-1 text-base font-medium">Accounts</span>
		<span class="text-base text-text-muted">{activeName()}{wallet.accounts.length > 1 ? ` · ${wallet.accounts.length}` : ''}</span>
	</button>
	<div class="flex flex-col gap-2">
		{@render section('gas', 'Gas credits', Fuel, gas)}
		{@render section('phrase', 'Recovery phrase', KeyRound, phraseBody)}
		{@render section('password', wallet.kind === 'pin' ? 'PIN' : 'Password', Lock, passwordBody)}
		{#if bioAvailable && wallet.kind === 'pin'}{@render section('bio', 'Fingerprint', Fingerprint, bioBody)}{/if}
		{@render section('emergency', 'Emergency PIN', ShieldAlert, emergencyBody)}
		{@render section('notify', 'Notifications', Bell, notifyBody)}
		{@render section('ff', 'Lightning (FixedFloat)', Zap, ffBody)}
		{@render section('network', 'Network', Globe, networkBody)}
	</div>
	<div class="flex flex-col gap-2">
		<Button variant="secondary" block size="lg" onclick={lock}>Lock now</Button>
		{#if !confirmRemove}
			<Button variant="ghost" block onclick={() => (confirmRemove = true)}>Remove account from this device</Button>
		{:else}
			<p class="text-label text-text-muted">Only your recovery phrase can bring this account back. Make sure you have it.</p>
			<Button block size="lg" onclick={forgetDevice}>Yes, remove it</Button>
			<Button variant="ghost" block onclick={() => (confirmRemove = false)}>Cancel</Button>
		{/if}
	</div>
{/snippet}

{#if page}
	<div class="flex flex-col gap-4">
		<PageHeader title="Settings" />
		{@render content()}
	</div>
{:else}
	<Modal title="Settings" onclose={close}>{@render content()}</Modal>
{/if}
