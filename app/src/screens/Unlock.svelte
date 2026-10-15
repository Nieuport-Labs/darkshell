<script lang="ts">
	import { t } from '../lib/i18n/index.svelte';
	import { Fingerprint } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import Button from '../components/ui/Button.svelte';
	import { biometricEnabled, biometricPin, disableBiometric } from '../lib/crypto/biometric';
	import PinPad from '../components/ui/PinPad.svelte';
	import { WrongPasswordError } from '../lib/crypto/vault';
	import { sheetWord } from '../lib/sheetWord';
	import { forgetDevice, LockedOutError, unlock, wallet } from '../lib/wallet.svelte';

	let pw = $state('');
	let busy = $state(false);
	let error = $state('');
	let reset = $state(0);
	let confirmForget = $state(false);
	let bio = $state(false);
	let word = $state('');
	void sheetWord().then((w) => (word = w));

	async function withFingerprint() {
		if (busy) return;
		try {
			const pin = await biometricPin();
			await attempt(pin);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			// the key is gone when fingerprints were added or removed: back to the PIN only
			if (/no protected credentials|invalidated|KeyPermanentlyInvalidated/i.test(msg)) {
				await disableBiometric();
				bio = false;
				error = t('Fingerprints changed on this phone. Enter your PIN, then turn fingerprint unlock on again in Settings.');
			}
			/* cancelled: just stay on the PIN pad */
		}
	}

	onMount(() => {
		void biometricEnabled().then((on) => {
			bio = on && wallet.kind === 'pin';
			if (bio) void withFingerprint();
		});
	});

	async function attempt(secret: string) {
		if (!secret || busy) return;
		busy = true;
		error = '';
		try {
			await unlock(secret);
			pw = '';
		} catch (err) {
			error =
				err instanceof LockedOutError
					? err.message
					: err instanceof WrongPasswordError
						? wallet.kind === 'pin'
							? t('Wrong PIN.')
							: t('Wrong password.')
						: err instanceof Error
							? err.message
							: String(err);
			reset++;
		} finally {
			busy = false;
		}
	}

	function submit(e: SubmitEvent) {
		e.preventDefault();
		void attempt(pw);
	}
</script>

<div class="mx-auto flex w-full max-w-[420px] flex-1 flex-col">
	<div class="flex flex-col items-center pt-6 text-center">
		<span class="halo enter size-16"><img src="/avatar.webp" alt="" class="size-16 rounded-pill object-cover" /></span>
		{#if word}<span class="mt-3 max-w-[70%] truncate rounded-pill border border-border bg-surface px-3 py-0.5 text-label font-medium" title={t('Your sheet word')}>{word}</span>{/if}
	</div>

	{#if wallet.kind === 'pin'}
		<PinPad title={t('Enter your PIN')} {error} {busy} bind:reset oncomplete={attempt}>
			{#snippet aux()}
				{#if bio}
					<button
						type="button"
						aria-label={t('Unlock with fingerprint')}
						onclick={withFingerprint}
						class="flex size-[4.75rem] items-center justify-center rounded-pill text-accent outline-none [-webkit-tap-highlight-color:transparent] focus-visible:ring-2 focus-visible:ring-accent"
					>
						<Fingerprint size={30} />
					</button>
				{/if}
			{/snippet}
		</PinPad>
	{:else}
		<form class="mt-8 flex flex-1 flex-col gap-3" onsubmit={submit}>
			<h1 class="text-center text-headline">{t('Welcome back')}</h1>
			<p class="text-center text-base text-text-muted">{t('Unlock with your password once; you can switch to a PIN in Settings.')}</p>
			<label class="field">
				<span class="text-label text-text-muted">{t('Password')}</span>
				<!-- svelte-ignore a11y_autofocus -->
				<input type="password" autocomplete="current-password" autofocus bind:value={pw} class="field-input" />
			</label>
			{#if error}<p class="text-base text-negative" role="alert">{error}</p>{/if}
			<Button type="submit" block size="lg" loading={busy}>{busy ? 'Unlocking…' : t('Unlock')}</Button>
		</form>
	{/if}

	<div class="flex flex-col gap-2 pb-2">
		{#if !confirmForget}
			<Button variant="ghost" block onclick={() => (confirmForget = true)}>{wallet.kind === 'pin' ? t('Forgot PIN?') : t('Forgot password?')}</Button>
		{:else}
			<p class="text-label text-text-muted">
				{t('It cannot be recovered. Remove this account from the device and restore it with your recovery phrase. Without the phrase the money is lost.')}
			</p>
			<Button variant="secondary" block size="lg" onclick={forgetDevice}>{t('Remove from this device')}</Button>
			<Button variant="ghost" block onclick={() => (confirmForget = false)}>{t('Cancel')}</Button>
		{/if}
	</div>
</div>
