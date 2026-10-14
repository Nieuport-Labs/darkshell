<script lang="ts">
	import { Bell, BookUser, Camera, ChevronRight, Fingerprint, Fuel, Globe, KeyRound, LayoutGrid, Link2, Lock, ShieldAlert, ShieldCheck, Shuffle, SlidersHorizontal, Trash2, Users, Zap } from '@lucide/svelte';
	import ConnectedSites from '../dapp/ConnectedSites.svelte';
	import { biometricAvailable, biometricEnabled } from '../../lib/crypto/biometric';
	import { allowBackground, backgroundUnrestricted, canNotify } from '../../lib/notify/background';
	import { isBech32Address } from 'secret-pay';
	import type { Snippet } from 'svelte';
	import { resetEndpoint } from '../../lib/chain/client';
	import { CREDIT_FLOOR, CREDIT_REFILL, CREDIT_URGENT, DEFAULT_LCD, GAS_VAULT_ADDRESS, REFILL_SHARE } from '../../lib/config';
	import { platform } from '../../lib/platform';
	import { allowScreenshots, screenshotsAllowed, screenShieldAvailable } from '../../lib/screenshots';
	import { duressNeedsRebind } from '../../lib/crypto/duress';
	import { SHEET_WORD_MAX, setSheetWord, sheetWord } from '../../lib/sheetWord';
	import { WrongPasswordError } from '../../lib/crypto/vault';
	import { builtInFf } from '../../lib/ff/fixedfloat';
	import { checkTor, setTor, tor, torAvailable, torLabel } from '../../lib/tor.svelte';
	import { formatAmount, shortAddress } from '../../lib/format';
	import { kv } from '../../lib/storage';
	import { close, open, setSimple, ui } from '../../lib/ui.svelte';
	import {
		activeName,
		changePin,
		emergencyPin,
		ffCredentials,
		forgetDevice,
		LockedOutError,
		lock,
		notificationsInBackground,
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

	type Page = 'security' | 'gas' | 'sites' | 'advanced';
	let { start }: { start?: Page } = $props();
	/** the overview (null) or one group's own page */
	// svelte-ignore state_referenced_locally
	let page = $state<Page | null>(start ?? null);
	const bioName = platform === 'ios' ? 'Face ID' : 'Fingerprint';
	const device = platform === 'extension' || platform === 'web' ? 'browser' : 'phone';

	/* screenshots */
	let shotsOn = $state(false);
	void screenshotsAllowed().then((v) => (shotsOn = v));
	async function shotsToggle() {
		shotsOn = await allowScreenshots(!shotsOn).catch(() => shotsOn);
	}

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
			bioMsg = `${bioName} unlock is on.`;
		} catch (err) {
			bioMsg = err instanceof WrongPasswordError ? 'Wrong PIN.' : `${bioName} was not confirmed. Nothing changed.`;
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

	/* sheet word */
	let word = $state('');
	let wordSaved = $state('');
	let wordMsg = $state('');
	void sheetWord().then((w) => (word = wordSaved = w));
	async function wordSave(e: SubmitEvent) {
		e.preventDefault();
		wordSaved = word = await setSheetWord(word);
		wordMsg = wordSaved ? 'Saved. Look for it whenever DarkShell asks for your PIN.' : 'Removed.';
	}

	/* emergency PIN */
	let em = $state(emergencyPin());
	let emRebind = $state(false);
	void duressNeedsRebind().then((v) => (emRebind = v));
	let emEdit = $state(false);
	let emTo = $state('');
	let emPin = $state('');
	let emCurrent = $state('');
	let emMsg = $state('');
	let emBusy = $state(false);
	const emToValid = $derived(isBech32Address(emTo.trim(), 'secret') && !wallet.accounts.some((a) => a.address === emTo.trim()));

	async function emSave(e: SubmitEvent) {
		e.preventDefault();
		emMsg = '';
		if (emTo.trim() && !emToValid) return (emMsg = 'Enter a secret1… address that is not one of your accounts here, or leave it empty.');
		if (!/^[0-9]{6}$/.test(emPin)) return (emMsg = 'The emergency PIN must be exactly 6 digits.');
		emBusy = true;
		try {
			await setEmergencyPin(emCurrent, emPin, emTo.trim() || undefined);
			em = emergencyPin();
			emRebind = false;
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

	let revealPw = $state('');
	let revealOpen = $state(false);
	let pwOpen = $state(false);
	let phrase = $state('');
	let revealError = $state('');
	let oldPw = $state('');
	let newPw = $state('');
	let pwMsg = $state('');

	const own = ffCredentials();
	let ffKey = $state(own?.key ?? '');
	let ffSecret = $state(own?.secret ?? '');
	let ffMsg = $state('');

	async function saveFf(e: SubmitEvent) {
		e.preventDefault();
		await setFfCredentials(ffKey.trim() && ffSecret.trim() ? { key: ffKey.trim(), secret: ffSecret.trim() } : undefined);
		ffMsg = ffKey.trim() ? 'Saved. Your own key is used from now on.' : builtInFf() ? 'Removed. The built-in key is used.' : 'Removed.';
	}


	const secretName = $derived(wallet.kind === 'pin' ? 'PIN' : 'password');
	let torChecking = $state(false);
	let torCheck = $state('');
	async function runTorCheck() {
		torChecking = true;
		torCheck = '';
		try {
			const r = await checkTor();
			torCheck = r.isTor ? `Yes — check.torproject.org sees a Tor exit (${r.ip}).` : `No — check.torproject.org sees ${r.ip}, not Tor.`;
		} catch (e) {
			torCheck = `Could not check: ${e instanceof Error ? e.message : String(e)}`;
		} finally {
			torChecking = false;
		}
	}

	let lcd = $state('');
	let confirmRemove = $state(false);
	kv.get<string>('settings.lcd').then((v) => (lcd = v ?? ''));

	const c = $derived(wallet.credits);
	const stateText = $derived(
		!c
			? 'Checking…'
			: {
					warm: 'Healthy. Network fees are paid from your gas credits.',
					low:
						c.remaining !== null && c.remaining < CREDIT_URGENT
							? `Running out. DarkShell adds ${formatAmount(CREDIT_REFILL)} SCRT with your next payment, from what it leaves.`
							: `Below ${formatAmount(CREDIT_FLOOR)} SCRT, still enough for dozens of payments. They are topped up once your balance can easily spare it.`,
					cold: 'Empty. When sSCRT arrives, DarkShell asks the fee faucet to pay the fee of the first top-up — no SCRT needed.',
					unknown: 'Could not be read right now. Nothing is lost.',
				}[c.state],
	);

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
			pwOpen = false;
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

{#snippet toggle(on: boolean, label: string, onclick: () => void)}
	<button type="button" role="switch" aria-checked={on} aria-label={label} {onclick} class="flex w-full items-center gap-3 text-left">
		<span class="flex-1 text-base font-medium">{label}</span>
		<span class="relative h-6 w-10 shrink-0 rounded-pill transition-colors duration-200 {on ? 'bg-accent-strong' : 'bg-surface-3'}">
			<span class="absolute top-0.5 size-5 rounded-pill bg-white shadow transition-transform duration-200 [transition-timing-function:var(--ease-emphasised)] {on ? 'translate-x-[1.125rem]' : 'translate-x-0.5'}"></span>
		</span>
	</button>
{/snippet}

{#snippet bioBody()}
	{@render toggle(bioOn, `Unlock with ${bioName}`, bioToggle)}
	<p class="text-label text-text-faint">
		Your PIN is kept in the phone's secure hardware and released only after a {bioName} check. Changing {platform === 'ios' ? 'Face ID' : 'fingerprints'} on the phone switches this off.
	</p>
	{#if bioAsk && !bioOn}
		<form class="flex flex-col gap-2" onsubmit={bioSave}>
			<input type="password" class="rounded-control border border-border bg-surface px-3 py-2.5 text-base outline-none" placeholder="Your PIN" inputmode="numeric" maxlength="6" autocomplete="current-password" bind:value={bioPin} />
			<Button type="submit" variant="secondary" shape="control">Confirm with {bioName}</Button>
		</form>
	{/if}
	{#if bioMsg}<p class="text-label text-text-muted">{bioMsg}</p>{/if}
{/snippet}

{#snippet wordBody()}
	<p class="text-label text-text-faint">A word only you know, shown wherever DarkShell asks for your PIN. A fake screen can't show it: no word, no PIN.</p>
	<form class="flex gap-2" onsubmit={wordSave}>
		<input class="min-w-0 flex-1 rounded-control border border-border bg-surface px-3 py-2.5 text-base outline-none" placeholder="e.g. Lighthouse" maxlength={SHEET_WORD_MAX} autocomplete="off" spellcheck="false" bind:value={word} />
		<Button type="submit" variant="secondary" shape="control" disabled={word.trim() === wordSaved}>Save</Button>
	</form>
	{#if wordMsg}<p class="text-label text-text-muted">{wordMsg}</p>{/if}
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
		A second PIN for when someone forces you to unlock. It erases your wallet from this {device}, sends your funds to a safe address if you set one, and opens a separate
		empty wallet as if nothing happened.
	</p>
	{#if em && emRebind}
		<p class="text-label text-negative">Saved before this phone's hardware key was used. Change it (same PIN is fine) to bind it to this phone.</p>
	{/if}
	{#if em && !emEdit}
		<div class="rounded-control bg-surface px-3 py-2.5 text-base">
			<span class="font-medium">On.</span>
			{#if em.to}Funds go to <span class="font-mono text-sm">{shortAddress(em.to, 10, 6)}</span>.{:else}Funds stay where they are (no safe address).{/if}
		</div>
		<div class="flex gap-2">
			<Button variant="secondary" shape="control" onclick={() => ((emEdit = true), (emTo = em!.to ?? ''))}>Change</Button>
			<Button variant="ghost" shape="control" onclick={emRemove}>Remove</Button>
		</div>
	{:else if !em && !emEdit}
		<Button variant="secondary" shape="control" class="self-start" onclick={() => ((emEdit = true), (emTo = ''))}>Set up</Button>
	{:else}
		<form class="flex flex-col gap-2" onsubmit={emSave}>
			<p class="text-label text-text-faint">
				The empty wallet is made now, in the background, and never shown anywhere. The transfer runs while the app is open: offline, or closed before it goes out, the
				funds stay where they are, and only your written-down recovery phrase reaches them.
			</p>
			<input class="rounded-control border border-border bg-surface px-3 py-2.5 font-mono text-sm outline-none" placeholder="Safe address (optional, secret1…)" autocomplete="off" spellcheck="false" bind:value={emTo} />
			<p class="text-label text-text-faint">
				Optional. Use a wallet that is not on this phone (a hardware wallet, or one at home). Fees come from your gas credits. Only your written-down recovery phrase brings
				this wallet back.
			</p>
			<input type="password" class="rounded-control border border-border bg-surface px-3 py-2.5 text-base outline-none" placeholder="New emergency PIN (6 digits)" inputmode="numeric" maxlength="6" autocomplete="off" bind:value={emPin} />
			<input type="password" class="rounded-control border border-border bg-surface px-3 py-2.5 text-base outline-none" placeholder={`Your normal ${secretName}`} inputmode={wallet.kind === 'pin' ? 'numeric' : 'text'} autocomplete="current-password" bind:value={emCurrent} />
			<div class="flex gap-2">
				<Button type="submit" variant="secondary" shape="control" loading={emBusy}>Save emergency PIN</Button>
				<Button variant="ghost" shape="control" onclick={() => (emEdit = false)}>Cancel</Button>
			</div>
		</form>
	{/if}
	{#if emMsg}<p class="text-label text-text-muted">{emMsg}</p>{/if}
{/snippet}

{#snippet gas()}
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
		)} SCRT: below {formatAmount(CREDIT_FLOOR)}, {formatAmount(CREDIT_REFILL)} are added from public SCRT you make private, or from sSCRT — with your next payment, or on their own when nothing else is being sent. A top-up only takes money you won't miss (while credits still pay dozens of fees, only from a balance of {formatAmount(CREDIT_REFILL * REFILL_SHARE)} or more), and never stops a payment: it is left off when it can't ride along.
	</p>
	{#if c?.state === 'cold'}
		<p class="text-label text-text-faint">
			<strong class="text-text-muted">First top-up:</strong> a fee faucet pays the fee of the first refill from your sSCRT (once a day). If it is unavailable, send about 0.1 public SCRT to your address instead.
		</p>
	{/if}
	<Button variant="soft" shape="control" onclick={() => open({ name: 'action', action: 'refill' })}>Refill {formatAmount(CREDIT_REFILL)} sSCRT now</Button>
{/snippet}

{#snippet phraseBody()}
	{#if phrase}
		<ol class="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-sm">
			{#each phrase.split(' ') as w, i (i)}<li><span class="inline-block w-6 text-right text-text-faint">{i + 1}</span> {w}</li>{/each}
		</ol>
		<p class="text-label text-text-faint">Write it down on paper. It can't be copied: other apps and the keyboard can read what is copied.</p>
		<div class="flex flex-wrap gap-2">
			<Button variant="secondary" shape="control" onclick={() => ((phrase = ''), (revealOpen = false))}>Hide</Button>
		</div>
	{:else if !revealOpen}
		<div class="flex items-center gap-3">
			<p class="flex-1 text-label text-text-faint">The 24 words that restore this wallet anywhere. Keep them on paper.</p>
			<Button variant="secondary" shape="control" onclick={() => (revealOpen = true)}>Show</Button>
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
	{#if !pwOpen}
		<div class="flex items-center gap-3">
			<p class="flex-1 text-label text-text-faint">{wallet.kind === 'pin' ? 'Six digits, asked when the wallet opens and for every payment.' : 'This wallet still uses a password. Switch to a 6-digit PIN.'}</p>
			<Button variant="secondary" shape="control" onclick={() => (pwOpen = true)}>Change</Button>
		</div>
	{:else}
	<form class="flex flex-col gap-2" onsubmit={change}>
		<input type="password" class="rounded-control border border-border bg-surface px-3 py-2.5 text-base outline-none" placeholder={wallet.kind === 'pin' ? 'Current PIN' : 'Current password'} inputmode={wallet.kind === 'pin' ? 'numeric' : 'text'} autocomplete="current-password" bind:value={oldPw} />
		<input type="password" class="rounded-control border border-border bg-surface px-3 py-2.5 text-base outline-none" placeholder="New 6-digit PIN" inputmode="numeric" maxlength="6" autocomplete="new-password" bind:value={newPw} />
		{#if pwMsg}<p class="text-label text-text-muted">{pwMsg}</p>{/if}
		<div class="flex gap-2">
			<Button type="submit" variant="secondary" shape="control">{wallet.kind === 'pin' ? 'Change PIN' : 'Switch to a PIN'}</Button>
			<Button variant="ghost" shape="control" onclick={() => ((pwOpen = false), (oldPw = newPw = ''))}>Cancel</Button>
		</div>
	</form>
	{/if}
	{#if pwMsg && !pwOpen}<p class="text-label text-text-muted">{pwMsg}</p>{/if}
{/snippet}

{#snippet networkBody()}
	{#if torAvailable}
		{@render toggle(tor.enabled, 'Connect through Tor', () => void setTor(!tor.enabled))}
		<p class="-mt-1 text-label text-text-faint">
			All of DarkShell's traffic goes through Tor, so the nodes and services it talks to don't see your IP address. Slower, and connecting takes up to a minute.
			{#if tor.enabled}<span class="block pt-1 {tor.status === 'ON' ? 'text-positive' : 'text-text-muted'}">Tor: {torLabel()}</span>{/if}
		</p>
		{#if tor.enabled && tor.status === 'ON'}
			<Button variant="ghost" shape="control" class="self-start" loading={torChecking} onclick={runTorCheck}>Check connection</Button>
			{#if torCheck}<p class="-mt-2 text-label {torCheck.startsWith('Yes') ? 'text-positive' : 'text-negative'}">{torCheck}</p>{/if}
		{/if}
	{/if}
	<form class="flex flex-col gap-2" onsubmit={saveLcd}>
		<p class="text-label text-text-faint">Secret Network mainnet (secret-4). DarkShell uses {DEFAULT_LCD.replace('https://', '')}, or public nodes when it does not answer. You can set your own LCD node instead.</p>
		<input class="rounded-control border border-border bg-surface px-3 py-2.5 font-mono text-sm outline-none" placeholder={DEFAULT_LCD} bind:value={lcd} />
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

{#snippet sitesBody()}
	<ConnectedSites />
{/snippet}


<!-- the overview: a few groups, each with its own page -->
{#snippet row(Icon: typeof Fuel, title: string, detail: string, onclick: () => void)}
	<button type="button" {onclick} class="state-layer -mx-2 flex items-center gap-3 rounded-card px-2 py-2.5 text-left">
		<span class="flex size-9 shrink-0 items-center justify-center rounded-pill bg-accent-soft text-accent"><Icon size={17} /></span>
		<span class="min-w-0 flex-1">
			<span class="block truncate text-base font-medium">{title}</span>
			{#if detail}<span class="block truncate text-label text-text-muted">{detail}</span>{/if}
		</span>
		<ChevronRight size={16} class="shrink-0 text-text-faint" />
	</button>
{/snippet}

{#snippet list(body: Snippet)}
	<div class="flex flex-col">{@render body()}</div>
{/snippet}

{#snippet walletRows()}
	{@render row(Users, 'Accounts', `${activeName()}${wallet.accounts.length > 1 ? ` · ${wallet.accounts.length} accounts` : ''}`, () => open({ name: 'accounts' }))}
	{@render row(BookUser, 'Address book', wallet.contacts.length ? `${wallet.contacts.length} contacts` : 'Saved addresses', () => open({ name: 'contacts' }))}
{/snippet}

{#snippet groupRows()}
	{@render row(
		ShieldCheck,
		'Security',
		[wallet.kind === 'pin' ? 'PIN' : 'Password', bioAvailable && wallet.kind === 'pin' ? bioName : '', 'recovery phrase', em ? 'emergency PIN on' : ''].filter(Boolean).join(', '),
		() => (page = 'security'),
	)}
	{@render row(Fuel, 'Gas credits', c ? { warm: 'Healthy', low: 'Running low', cold: 'Empty', unknown: 'Could not be read' }[c.state] : 'Network fees', () => (page = 'gas'))}
	{@render row(Link2, 'Connected sites', 'dApps that can see this account', () => (page = 'sites'))}
	{@render row(Shuffle, 'Swap other tokens', 'Turn them into sSCRT', () => open({ name: 'sweep' }))}
	{@render row(SlidersHorizontal, 'Advanced', `Notifications, Lightning, ${torAvailable ? 'Tor, ' : ''}network node`, () => (page = 'advanced'))}
{/snippet}

{#snippet simpleRow()}
	<div class="flex items-center gap-3 py-2.5">
		<span class="flex size-9 shrink-0 items-center justify-center rounded-pill bg-accent-soft text-accent"><LayoutGrid size={17} /></span>
		<div class="min-w-0 flex-1">
			{@render toggle(ui.simple, 'Simple app', () => void setSimple(!ui.simple))}
			<p class="text-label text-text-muted">Just your balance, Send and Receive</p>
		</div>
	</div>
{/snippet}

{#snippet overview()}
	{@render list(walletRows)}
	<hr class="border-border" />
	{@render list(groupRows)}
	<hr class="border-border" />
	{@render list(simpleRow)}
	<Button variant="secondary" block onclick={lock}><Lock size={16} /> Lock now</Button>
{/snippet}

{#snippet removeBody()}
	{#if !confirmRemove}
		<p class="text-label text-text-faint">Erases the wallet from this {device}. Your funds stay at your address.</p>
		<Button variant="ghost" shape="control" class="self-start text-negative" onclick={() => (confirmRemove = true)}>Remove from this device</Button>
	{:else}
		<p class="text-label text-text-muted">Only your recovery phrase can bring this account back. Make sure you have it.</p>
		<div class="flex gap-2">
			<Button shape="control" onclick={forgetDevice}>Yes, remove it</Button>
			<Button variant="ghost" shape="control" onclick={() => (confirmRemove = false)}>Cancel</Button>
		</div>
	{/if}
{/snippet}

<!-- one setting within a group's page: a heading and its card -->
{#snippet item(Icon: typeof Fuel, title: string, body: Snippet)}
	<section class="flex flex-col gap-3 border-t border-border pt-5 first:border-t-0 first:pt-0">
		<h3 class="flex items-center gap-2 text-title font-medium"><Icon size={17} class="text-accent" />{title}</h3>
		{@render body()}
	</section>
{/snippet}

{#snippet shotsBody()}
	{@render toggle(shotsOn, 'Allow screenshots', shotsToggle)}
	<p class="text-label text-text-faint">
		Off: screenshots and screen recording show nothing{platform === 'android' ? ', and the app is blank in recent apps' : ''}. On: they work, and can capture your balance or your recovery phrase while it is shown.
	</p>
{/snippet}

{#snippet securityPage()}
	{@render item(Lock, wallet.kind === 'pin' ? 'PIN' : 'Password', passwordBody)}
	{#if bioAvailable && wallet.kind === 'pin'}{@render item(Fingerprint, bioName, bioBody)}{/if}
	{@render item(KeyRound, 'Recovery phrase', phraseBody)}
	{@render item(ShieldCheck, 'Sheet word', wordBody)}
	{@render item(ShieldAlert, 'Emergency PIN', emergencyBody)}
	{#if screenShieldAvailable}{@render item(Camera, 'Screenshots', shotsBody)}{/if}
	{@render item(Trash2, 'Remove wallet', removeBody)}
{/snippet}

{#snippet advancedPage()}
	{@render item(Bell, 'Notifications', notifyBody)}
	{@render item(Zap, 'Lightning (FixedFloat)', ffBody)}
	{@render item(Globe, 'Network', networkBody)}
{/snippet}

{#snippet gasPage()}
	<div class="flex flex-col gap-3">{@render gas()}</div>
{/snippet}

{#snippet sitesPage()}
	<ConnectedSites />
{/snippet}

{#if page === null}
	<Modal full title="Settings" onclose={close}>{@render overview()}</Modal>
{:else}
	{@const pages = {
		security: ['Security', securityPage],
		gas: ['Gas credits', gasPage],
		sites: ['Connected sites', sitesPage],
		advanced: ['Advanced', advancedPage],
	} satisfies Record<Page, [string, Snippet]>}
	{#key page}
		<Modal full title={pages[page][0]} onback={() => ((page = null), (phrase = ''), (revealOpen = pwOpen = false))} onclose={close}>{@render pages[page][1]()}</Modal>
	{/key}
{/if}
