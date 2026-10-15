<script lang="ts">
	import { i18n, LANGS, setLang, t, tn } from '../../lib/i18n/index.svelte';
	import { Bell, BookUser, Camera, Check, ChevronRight, Fingerprint, Fuel, Globe, KeyRound, Languages, LayoutGrid, Link2, Lock, ShieldAlert, ShieldCheck, Shuffle, SlidersHorizontal, Trash2, Users, Zap } from '@lucide/svelte';
	import Flag from '../ui/Flag.svelte';
	import { FIATS, fiat, setFiat } from '../../lib/price.svelte';
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
		emergencyNeedsBiometric,
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

	type Page = 'security' | 'gas' | 'sites' | 'advanced' | 'region';
	let { start }: { start?: Page } = $props();
	/** the overview (null) or one group's own page */
	// svelte-ignore state_referenced_locally
	let page = $state<Page | null>(start ?? null);
	const bioName = $derived(platform === 'ios' ? 'Face ID' : t('Fingerprint'));
	const device = $derived(platform === 'extension' || platform === 'web' ? t('this browser') : t('this phone'));

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
			bioMsg = t('{method} unlock is on.', { method: bioName });
		} catch (err) {
			bioMsg = err instanceof WrongPasswordError ? t('Wrong PIN.') : t('{method} was not confirmed. Nothing changed.', { method: bioName });
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
			if (want && !got) bgMsg = t('Notifications are not allowed for DarkShell. Allow them in Android settings and try again.');
			else if (got) bgMsg = t('On. You will get a phone notification for incoming payments.');
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
		wordMsg = wordSaved ? t('Saved. Look for it whenever DarkShell asks for your PIN.') : t('Removed.');
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
		if (emTo.trim() && !emToValid) return (emMsg = t('Enter a secret1… address that is not one of your accounts here, or leave it empty.'));
		if (!/^[0-9]{6}$/.test(emPin)) return (emMsg = t('The emergency PIN must be exactly 6 digits.'));
		emBusy = true;
		try {
			await setEmergencyPin(emCurrent, emPin, emTo.trim() || undefined);
			em = emergencyPin();
			emRebind = false;
			emEdit = false;
			emPin = emCurrent = '';
			emMsg = t('Emergency PIN saved.');
		} catch (err) {
			emMsg = err instanceof WrongPasswordError ? t('Your current {secret} is wrong.', { secret: secretName }) : err instanceof Error ? err.message : String(err);
		} finally {
			emBusy = false;
		}
	}

	async function emRemove() {
		await removeEmergencyPin();
		em = null;
		emMsg = t('Emergency PIN removed.');
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
		ffMsg = ffKey.trim() ? t('Saved. Your own key is used from now on.') : builtInFf() ? t('Removed. The built-in key is used.') : t('Removed.');
	}


	const secretName = $derived(wallet.kind === 'pin' ? 'PIN' : t('password'));
	let torChecking = $state(false);
	let torCheck = $state('');
	let torOk = $state(false);
	async function runTorCheck() {
		torChecking = true;
		torCheck = '';
		try {
			const r = await checkTor();
			torOk = r.isTor;
			torCheck = r.isTor ? t('Yes — check.torproject.org sees a Tor exit ({ip}).', { ip: r.ip }) : t('No — check.torproject.org sees {ip}, not Tor.', { ip: r.ip });
		} catch (e) {
			torOk = false;
			torCheck = t('Could not check: {error}', { error: e instanceof Error ? e.message : String(e) });
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
			? t('Checking…')
			: {
					warm: t('Healthy. Network fees are paid from your gas credits.'),
					low:
						c.remaining !== null && c.remaining < CREDIT_URGENT
							? t('Running out. DarkShell adds {amount} SCRT with your next payment, from what it leaves.', { amount: formatAmount(CREDIT_REFILL) })
							: t('Below {amount} SCRT, still enough for dozens of payments. They are topped up once your balance can easily spare it.', { amount: formatAmount(CREDIT_FLOOR) }),
					cold: t('Empty. When sSCRT arrives, DarkShell asks the fee faucet to pay the fee of the first top-up — no SCRT needed.'),
					unknown: t('Could not be read right now. Nothing is lost.'),
				}[c.state],
	);

	async function reveal(e: SubmitEvent) {
		e.preventDefault();
		revealError = '';
		try {
			phrase = await revealMnemonic(revealPw);
			revealPw = '';
		} catch (err) {
			revealError = err instanceof WrongPasswordError ? t('Wrong {secret}.', { secret: secretName }) : err instanceof LockedOutError ? err.message : String(err);
		}
	}

	async function change(e: SubmitEvent) {
		e.preventDefault();
		if (!/^[0-9]{6}$/.test(newPw)) return (pwMsg = t('The new PIN must be exactly 6 digits.'));
		try {
			await changePin(oldPw, newPw);
			pwMsg = t('PIN changed.');
			oldPw = newPw = '';
			pwOpen = false;
		} catch (err) {
			pwMsg = err instanceof WrongPasswordError ? t('The current {secret} is wrong.', { secret: secretName }) : err instanceof Error ? err.message : String(err);
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
	{@render toggle(bioOn, t('Unlock with {method}', { method: bioName }), bioToggle)}
	<p class="text-label text-text-faint">
		{platform === 'ios'
			? t("Your PIN is kept in the phone's secure hardware and released only after a Face ID check. Changing Face ID on the phone switches this off.")
			: t("Your PIN is kept in the phone's secure hardware and released only after a fingerprint check. Changing fingerprints on the phone switches this off.")}
	</p>
	{#if bioOn && emergencyNeedsBiometric()}
		<p class="text-label text-negative">{t('Save your emergency PIN again (Security → Emergency PIN), so it works with {method} too.', { method: bioName })}</p>
	{/if}
	{#if bioAsk && !bioOn}
		<form class="flex flex-col gap-2" onsubmit={bioSave}>
			<input type="password" class="rounded-control border border-border bg-surface px-3 py-2.5 text-base outline-none" placeholder={t('Your PIN')} inputmode="numeric" maxlength="6" autocomplete="current-password" bind:value={bioPin} />
			<Button type="submit" variant="secondary" shape="control">{t('Confirm with {method}', { method: bioName })}</Button>
		</form>
	{/if}
	{#if bioMsg}<p class="text-label text-text-muted">{bioMsg}</p>{/if}
{/snippet}

{#snippet wordBody()}
	<p class="text-label text-text-faint">{t('A word only you know, shown wherever DarkShell asks for your PIN. A fake screen can\'t show it: no word, no PIN.')}</p>
	<form class="flex gap-2" onsubmit={wordSave}>
		<input class="min-w-0 flex-1 rounded-control border border-border bg-surface px-3 py-2.5 text-base outline-none" placeholder={t('e.g. Lighthouse')} maxlength={SHEET_WORD_MAX} autocomplete="off" spellcheck="false" bind:value={word} />
		<Button type="submit" variant="secondary" shape="control" disabled={word.trim() === wordSaved}>{t('Save')}</Button>
	</form>
	{#if wordMsg}<p class="text-label text-text-muted">{wordMsg}</p>{/if}
{/snippet}

{#snippet notifyBody()}
	<p class="text-label text-text-faint">
		{t('While DarkShell is open, every incoming sSCRT payment shows up within seconds, and an open invoice turns paid by itself. It uses SNIP-52 private notifications: the app reads public sSCRT transactions and recognises its own with a key only you and the sSCRT contract know. No server learns which payments are yours.')}
	</p>
	{#if canNotify}
		{@render toggle(bgOn, t('Also when the app is closed'), bgToggle)}
		<p class="text-label text-text-faint">
			{t('Within seconds of the block, like a chat app. DarkShell keeps one quiet connection open and the phone sleeps until an sSCRT payment appears; Android shows a small silent “Watching for payments” notice while it runs. The notification keys are kept on the phone unencrypted — they can only recognise incoming payments, never spend.')}
		</p>
		{#if bgOn && !bgUnrestricted}
			<Button variant="secondary" shape="control" onclick={() => allowBackground().then(() => setTimeout(() => backgroundUnrestricted().then((v) => (bgUnrestricted = v)), 4000))}>
				{t('Let it run without battery limits')}
			</Button>
			<p class="-mt-1 text-label text-text-faint">{t('Some phones stop background apps to save battery; this keeps notifications on time.')}</p>
		{/if}
		{#if bgMsg}<p class="text-label {bgOk ? 'text-text-muted' : 'text-negative'}">{bgMsg}</p>{/if}
	{/if}
{/snippet}

{#snippet emergencyBody()}
	<p class="text-label text-text-faint">
		{t('A second PIN for when someone forces you to unlock. It erases your wallet from {device}, sends your funds to a safe address if you set one, and opens a separate empty wallet as if nothing happened.', { device })}
	</p>
	{#if em && emRebind}
		<p class="text-label text-negative">{t('Saved before this phone\'s hardware key was used. Change it (same PIN is fine) to bind it to this phone.')}</p>
	{/if}
	{#if em && !emEdit}
		<div class="rounded-control bg-surface px-3 py-2.5 text-base">
			<span class="font-medium">{t('On.')}</span>
			{#if em.to}{t('Funds go to')} <span class="font-mono text-sm">{shortAddress(em.to, 10, 6)}</span>.{:else}{t('Funds stay where they are (no safe address).')}{/if}
		</div>
		<div class="flex gap-2">
			<Button variant="secondary" shape="control" onclick={() => ((emEdit = true), (emTo = em!.to ?? ''))}>{t('Change')}</Button>
			<Button variant="ghost" shape="control" onclick={emRemove}>{t('Remove')}</Button>
		</div>
	{:else if !em && !emEdit}
		<Button variant="secondary" shape="control" class="self-start" onclick={() => ((emEdit = true), (emTo = ''))}>{t('Set up')}</Button>
	{:else}
		<form class="flex flex-col gap-2" onsubmit={emSave}>
			<p class="text-label text-text-faint">
				{t('The empty wallet is made now, in the background, and never shown anywhere. The transfer runs while the app is open: offline, or closed before it goes out, the funds stay where they are, and only your written-down recovery phrase reaches them.')}
			</p>
			<input class="rounded-control border border-border bg-surface px-3 py-2.5 font-mono text-sm outline-none" placeholder={t('Safe address (optional, secret1…)')} autocomplete="off" spellcheck="false" bind:value={emTo} />
			<p class="text-label text-text-faint">
				{t('Optional. Use a wallet that is not on {device} (a hardware wallet, or one at home). Fees come from your gas credits. Only your written-down recovery phrase brings this wallet back.', { device })}
			</p>
			<input type="password" class="rounded-control border border-border bg-surface px-3 py-2.5 text-base outline-none" placeholder={t('New emergency PIN (6 digits)')} inputmode="numeric" maxlength="6" autocomplete="off" bind:value={emPin} />
			<input type="password" class="rounded-control border border-border bg-surface px-3 py-2.5 text-base outline-none" placeholder={t('Your normal {secret}', { secret: secretName })} inputmode={wallet.kind === 'pin' ? 'numeric' : 'text'} autocomplete="current-password" bind:value={emCurrent} />
			<div class="flex gap-2">
				<Button type="submit" variant="secondary" shape="control" loading={emBusy}>{t('Save emergency PIN')}</Button>
				<Button variant="ghost" shape="control" onclick={() => (emEdit = false)}>{t('Cancel')}</Button>
			</div>
		</form>
	{/if}
	{#if emMsg}<p class="text-label text-text-muted">{emMsg}</p>{/if}
{/snippet}

{#snippet gas()}
	<p class="text-base text-text-muted">{stateText}</p>
	<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-base">
		<dt class="text-text-faint">{t('Credits left')}</dt>
		<dd class="text-right tabular-nums">{c?.remaining != null ? `${formatAmount(c.remaining)} SCRT` : '—'}</dd>
		<dt class="text-text-faint">{t('Public SCRT')}</dt>
		<dd class="text-right tabular-nums">{formatAmount(wallet.native)} SCRT</dd>
		<dt class="text-text-faint">{t('Vault')}</dt>
		<dd class="text-right font-mono text-sm">{shortAddress(GAS_VAULT_ADDRESS, 10, 6)}</dd>
	</dl>
	<p class="text-label text-text-faint">
		{t("Fees are paid from prepaid gas credits, a fee grant from the gas vault, so you never need SCRT. They are kept between {floor} and {top} SCRT: below {floor}, {refill} are added from public SCRT you make private, or from sSCRT — with your next payment, or on their own when nothing else is being sent. A top-up only takes money you won't miss (while credits still pay dozens of fees, only from a balance of {min} or more), and never stops a payment: it is left off when it can't ride along.", {
			floor: formatAmount(CREDIT_FLOOR),
			top: formatAmount(CREDIT_FLOOR + CREDIT_REFILL),
			refill: formatAmount(CREDIT_REFILL),
			min: formatAmount(CREDIT_REFILL * REFILL_SHARE),
		})}
	</p>
	{#if c?.state === 'cold'}
		<p class="text-label text-text-faint">
			<strong class="text-text-muted">{t('First top-up:')}</strong> {t('a fee faucet pays the fee of the first refill from your sSCRT (once a day). If it is unavailable, send about 0.1 public SCRT to your address instead.')}
		</p>
	{/if}
	<Button variant="soft" shape="control" onclick={() => open({ name: 'action', action: 'refill' })}>{t('Refill {amount} sSCRT now', { amount: formatAmount(CREDIT_REFILL) })}</Button>
{/snippet}

{#snippet phraseBody()}
	{#if phrase}
		<ol class="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-sm">
			{#each phrase.split(' ') as w, i (i)}<li><span class="inline-block w-6 text-right text-text-faint">{i + 1}</span> {w}</li>{/each}
		</ol>
		<p class="text-label text-text-faint">{t('Write it down on paper. It can\'t be copied: other apps and the keyboard can read what is copied.')}</p>
		<div class="flex flex-wrap gap-2">
			<Button variant="secondary" shape="control" onclick={() => ((phrase = ''), (revealOpen = false))}>{t('Hide')}</Button>
		</div>
	{:else if !revealOpen}
		<div class="flex items-center gap-3">
			<p class="flex-1 text-label text-text-faint">{t('The 24 words that restore this wallet anywhere. Keep them on paper.')}</p>
			<Button variant="secondary" shape="control" onclick={() => (revealOpen = true)}>{t('Show')}</Button>
		</div>
	{:else}
		<form class="flex flex-col gap-2" onsubmit={reveal}>
			<input type="password" class="rounded-control border border-border bg-surface px-3 py-2.5 text-base outline-none" placeholder={wallet.kind === 'pin' ? 'PIN' : t('Password')} inputmode={wallet.kind === 'pin' ? 'numeric' : 'text'} autocomplete="current-password" bind:value={revealPw} />
			{#if revealError}<p class="text-label text-negative">{revealError}</p>{/if}
			<Button type="submit" variant="secondary" shape="control">{t('Show recovery phrase')}</Button>
		</form>
	{/if}
{/snippet}

{#snippet passwordBody()}
	{#if !pwOpen}
		<div class="flex items-center gap-3">
			<p class="flex-1 text-label text-text-faint">{wallet.kind === 'pin' ? t('Six digits, asked when the wallet opens and for every payment.') : t('This wallet still uses a password. Switch to a 6-digit PIN.')}</p>
			<Button variant="secondary" shape="control" onclick={() => (pwOpen = true)}>{t('Change')}</Button>
		</div>
	{:else}
	<form class="flex flex-col gap-2" onsubmit={change}>
		<input type="password" class="rounded-control border border-border bg-surface px-3 py-2.5 text-base outline-none" placeholder={wallet.kind === 'pin' ? t('Current PIN') : t('Current password')} inputmode={wallet.kind === 'pin' ? 'numeric' : 'text'} autocomplete="current-password" bind:value={oldPw} />
		<input type="password" class="rounded-control border border-border bg-surface px-3 py-2.5 text-base outline-none" placeholder={t('New 6-digit PIN')} inputmode="numeric" maxlength="6" autocomplete="new-password" bind:value={newPw} />
		{#if pwMsg}<p class="text-label text-text-muted">{pwMsg}</p>{/if}
		<div class="flex gap-2">
			<Button type="submit" variant="secondary" shape="control">{wallet.kind === 'pin' ? t('Change PIN') : t('Switch to a PIN')}</Button>
			<Button variant="ghost" shape="control" onclick={() => ((pwOpen = false), (oldPw = newPw = ''))}>{t('Cancel')}</Button>
		</div>
	</form>
	{/if}
	{#if pwMsg && !pwOpen}<p class="text-label text-text-muted">{pwMsg}</p>{/if}
{/snippet}

{#snippet networkBody()}
	{#if torAvailable}
		{@render toggle(tor.enabled, t('Connect through Tor'), () => void setTor(!tor.enabled))}
		<p class="-mt-1 text-label text-text-faint">
			{t("All of DarkShell's traffic goes through Tor, so the nodes and services it talks to don't see your IP address. Slower, and connecting takes up to a minute.")}
			{#if tor.enabled}<span class="block pt-1 {tor.status === 'ON' ? 'text-positive' : 'text-text-muted'}">Tor: {torLabel()}</span>{/if}
		</p>
		{#if tor.enabled && tor.status === 'ON'}
			<Button variant="ghost" shape="control" class="self-start" loading={torChecking} onclick={runTorCheck}>{t('Check connection')}</Button>
			{#if torCheck}<p class="-mt-2 text-label {torOk ? 'text-positive' : 'text-negative'}">{torCheck}</p>{/if}
		{/if}
	{/if}
	<form class="flex flex-col gap-2" onsubmit={saveLcd}>
		<p class="text-label text-text-faint">{t('Secret Network mainnet (secret-4). DarkShell uses {node}, or public nodes when it does not answer. You can set your own LCD node instead.', { node: DEFAULT_LCD.replace('https://', '') })}</p>
		<input class="rounded-control border border-border bg-surface px-3 py-2.5 font-mono text-sm outline-none" placeholder={DEFAULT_LCD} bind:value={lcd} />
		<Button type="submit" variant="secondary" shape="control">{t('Save')}</Button>
	</form>
{/snippet}

{#snippet ffBody()}
	<form class="flex flex-col gap-2" onsubmit={saveFf}>
		<p class="text-label text-text-faint">
			{t('Lightning invoices are paid through FixedFloat (ff.io).')}
			{builtInFf() ? t('This build has a key built in; you can use your own instead.') : t('Add your FixedFloat API key to enable it.')}
			{t('Your key is stored encrypted with your recovery phrase.')}
		</p>
		<input class="rounded-control border border-border bg-surface px-3 py-2.5 font-mono text-sm outline-none" placeholder={t('API key')} autocomplete="off" spellcheck="false" bind:value={ffKey} />
		<input type="password" class="rounded-control border border-border bg-surface px-3 py-2.5 font-mono text-sm outline-none" placeholder={t('API secret')} autocomplete="off" bind:value={ffSecret} />
		{#if ffMsg}<p class="text-label text-text-muted">{ffMsg}</p>{/if}
		<Button type="submit" variant="secondary" shape="control">{t('Save')}</Button>
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
	{@render row(Users, t('Accounts'), `${activeName()}${wallet.accounts.length > 1 ? ` · ${tn('{n} accounts', wallet.accounts.length)}` : ''}`, () => open({ name: 'accounts' }))}
	{@render row(BookUser, t('Address book'), wallet.contacts.length ? tn('{n} contacts', wallet.contacts.length) : t('Saved addresses'), () => open({ name: 'contacts' }))}
{/snippet}

{#snippet groupRows()}
	{@render row(
		ShieldCheck,
		t('Security'),
		[wallet.kind === 'pin' ? 'PIN' : t('Password'), bioAvailable && wallet.kind === 'pin' ? bioName : '', t('recovery phrase'), em ? t('emergency PIN on') : ''].filter(Boolean).join(', '),
		() => (page = 'security'),
	)}
	{@render row(Fuel, t('Gas credits'), c ? { warm: t('Healthy'), low: t('Running low'), cold: t('Empty'), unknown: t('Could not be read') }[c.state] : t('Network fees'), () => (page = 'gas'))}
	{@render row(Link2, t('Connected sites'), t('dApps that can see this account'), () => (page = 'sites'))}
	{@render row(Shuffle, t('Swap other tokens'), t('Turn them into sSCRT'), () => open({ name: 'sweep' }))}
	{@render row(Languages, t('Language and currency'), `${LANGS.find((l) => l.code === i18n.lang)!.name} · ${fiat.code}`, () => (page = 'region'))}
	{@render row(SlidersHorizontal, t('Advanced'), torAvailable ? t('Notifications, Lightning, Tor, network node') : t('Notifications, Lightning, network node'), () => (page = 'advanced'))}
{/snippet}

{#snippet simpleRow()}
	<div class="flex items-center gap-3 py-2.5">
		<span class="flex size-9 shrink-0 items-center justify-center rounded-pill bg-accent-soft text-accent"><LayoutGrid size={17} /></span>
		<div class="min-w-0 flex-1">
			{@render toggle(ui.simple, t('Simple app'), () => void setSimple(!ui.simple))}
			<p class="text-label text-text-muted">{t('Just your balance, Send and Receive')}</p>
		</div>
	</div>
{/snippet}

{#snippet overview()}
	{@render list(walletRows)}
	<hr class="border-border" />
	{@render list(groupRows)}
	<hr class="border-border" />
	{@render list(simpleRow)}
	<Button variant="secondary" block onclick={lock}>
		{#snippet icon()}<Lock size={16} />{/snippet}
		{t('Lock now')}
	</Button>
{/snippet}

{#snippet removeBody()}
	{#if !confirmRemove}
		<p class="text-label text-text-faint">{t('Erases the wallet from {device}. Your funds stay at your address.', { device })}</p>
		<Button variant="ghost" shape="control" class="self-start text-negative" onclick={() => (confirmRemove = true)}>{t('Remove from this device')}</Button>
	{:else}
		<p class="text-label text-text-muted">{t('Only your recovery phrase can bring this account back. Make sure you have it.')}</p>
		<div class="flex gap-2">
			<Button shape="control" onclick={forgetDevice}>{t('Yes, remove it')}</Button>
			<Button variant="ghost" shape="control" onclick={() => (confirmRemove = false)}>{t('Cancel')}</Button>
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
	{@render toggle(shotsOn, t('Allow screenshots'), shotsToggle)}
	<p class="text-label text-text-faint">
		{platform === 'android'
			? t('Off: screenshots and screen recording show nothing, and the app is blank in recent apps. On: they work, and can capture your balance or your recovery phrase while it is shown.')
			: t('Off: screen recording shows nothing. On: it works, and can capture your balance or your recovery phrase while it is shown.')}
	</p>
{/snippet}

{#snippet securityPage()}
	{@render item(Lock, wallet.kind === 'pin' ? 'PIN' : t('Password'), passwordBody)}
	{#if bioAvailable && wallet.kind === 'pin'}{@render item(Fingerprint, bioName, bioBody)}{/if}
	{@render item(KeyRound, t('Recovery phrase'), phraseBody)}
	{@render item(ShieldCheck, t('Sheet word'), wordBody)}
	{@render item(ShieldAlert, t('Emergency PIN'), emergencyBody)}
	{#if screenShieldAvailable}{@render item(Camera, t('Screenshots'), shotsBody)}{/if}
	{@render item(Trash2, t('Remove wallet'), removeBody)}
{/snippet}

{#snippet advancedPage()}
	{@render item(Bell, t('Notifications'), notifyBody)}
	{@render item(Zap, t('Lightning (FixedFloat)'), ffBody)}
	{@render item(Globe, t('Network'), networkBody)}
{/snippet}

{#snippet pick(selected: boolean, onclick: () => void, body: Snippet)}
	<button type="button" {onclick} aria-pressed={selected} class="state-layer -mx-2 flex items-center gap-3 rounded-card px-2 py-2.5 text-left">
		{@render body()}
		{#if selected}<Check size={18} class="ml-auto shrink-0 text-accent" />{/if}
	</button>
{/snippet}

{#snippet langBody()}
	<div class="flex flex-col">
		{#each LANGS as l (l.code)}
			{#snippet body()}<Flag lang={l.code} size={26} /><span class="text-base font-medium">{l.name}</span>{/snippet}
			{@render pick(i18n.lang === l.code, () => void setLang(l.code), body)}
		{/each}
	</div>
{/snippet}

{#snippet fiatBody()}
	<div class="flex flex-col">
		{#each FIATS as f (f.code)}
			{#snippet body()}
				<span class="flex size-9 shrink-0 items-center justify-center rounded-pill bg-surface-3 font-semibold">{f.symbol}</span>
				<span class="text-base font-medium">{t(f.name)} <span class="text-text-faint">· {f.code}</span></span>
			{/snippet}
			{@render pick(fiat.code === f.code, () => void setFiat(f.code), body)}
		{/each}
	</div>
	<p class="text-label text-text-faint">{t('Euro and koruna use the European Central Bank’s daily rate (frankfurter.dev).')}</p>
{/snippet}

{#snippet regionPage()}
	{@render item(Languages, t('Language'), langBody)}
	{@render item(Fuel, t('Currency'), fiatBody)}
{/snippet}

{#snippet gasPage()}
	<div class="flex flex-col gap-3">{@render gas()}</div>
{/snippet}

{#snippet sitesPage()}
	<ConnectedSites />
{/snippet}

{#if page === null}
	<Modal full title={t('Settings')} onclose={close}>{@render overview()}</Modal>
{:else}
	{@const pages = {
		security: [t('Security'), securityPage],
		gas: [t('Gas credits'), gasPage],
		sites: [t('Connected sites'), sitesPage],
		advanced: [t('Advanced'), advancedPage],
		region: [t('Language and currency'), regionPage],

	} satisfies Record<Page, [string, Snippet]>}
	{#key page}
		<Modal full title={pages[page][0]} onback={() => ((page = null), (phrase = ''), (revealOpen = pwOpen = false))} onclose={close}>{@render pages[page][1]()}</Modal>
	{/key}
{/if}
