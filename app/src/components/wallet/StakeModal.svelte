<script lang="ts">
	import { t } from '../../lib/i18n/index.svelte';
	// Stake (from sSCRT) or unstake: enter an amount, review, swipe. One
	// transaction each. Staking suggests a validator (changeable); unstaking
	// with a single validator goes straight to the amount. Opened on a
	// validator, it shows your stake there first.
	import { ExternalLink, Hourglass, Search, ShieldCheck, Sprout } from '@lucide/svelte';
	import { fromBaseUnits, toBaseUnits } from 'secret-pay';
	import { untrack } from 'svelte';
	import { BusyError, type TxOutcome } from '../../lib/chain/tx';
	import { MIN_WRAP_REWARD, suggestValidator } from '../../lib/chain/staking';
	import { formatAmount } from '../../lib/format';
	import { NoGasError } from '../../lib/gas/feePayer';
	import { fiatValue } from '../../lib/price.svelte';
	import { delegationTo, loadStaking, rewardOf, stake, staking, totalStaked, unstake, validatorOf } from '../../lib/staking.svelte';
	import { close } from '../../lib/ui.svelte';
	import { prefetchForPayment, spendable, wallet } from '../../lib/wallet.svelte';
	import AmountHero from '../ui/AmountHero.svelte';
	import Button from '../ui/Button.svelte';
	import Modal from '../ui/Modal.svelte';
	import SwipeConfirm from '../ui/SwipeConfirm.svelte';
	import TxStage from './TxStage.svelte';
	import { haptic } from '../../lib/haptics';
	import ValidatorAvatar from './ValidatorAvatar.svelte';

	let { validator: initial, mode: initialMode }: { validator?: string; mode?: 'stake' | 'unstake' } = $props();

	type Step = 'pick' | 'manage' | 'amount' | 'review';
	let validator = $state(untrack(() => initial ?? ''));
	let mode = $state<'stake' | 'unstake'>(untrack(() => initialMode ?? 'stake'));
	// no validator given: straight to the amount (one is suggested, or the only one you use)
	let step = $state<Step>(untrack(() => (initial && !initialMode ? 'manage' : 'amount')));
	/** the validator was chosen for the user, not by them */
	let suggested = $state(false);

	$effect(() => {
		if (validator || step !== 'amount' || !staking.loaded) return;
		if (mode === 'unstake') {
			if (staking.delegations.length === 1) validator = staking.delegations[0].validator;
			else step = 'pick';
			return;
		}
		const s = suggestValidator(staking.validators, staking.delegations.map((d) => d.validator), wallet.address);
		if (s) {
			validator = s.address;
			suggested = true;
		} else if (staking.validators.length) step = 'pick';
	});
	let query = $state('');
	let amount = $state('');
	let sending = $state(false);
	let failure = $state('');
	let outcome = $state<TxOutcome | null>(null);

	if (!staking.loaded) void loadStaking();
	prefetchForPayment();

	const v = $derived(validatorOf(validator));
	const mine = $derived(delegationTo(validator));
	const reward = $derived(rewardOf(validator));
	/** rewards this transaction pays out and deposits into sSCRT */
	const wrapsReward = $derived(staking.ownWithdraw && !staking.restaking.includes(validator) && reward >= MIN_WRAP_REWARD ? reward : 0n);
	const bondedTotal = $derived(staking.validators.filter((x) => x.bonded).reduce((s, x) => s + x.tokens, 0n));
	const share = (tokens: bigint) => (bondedTotal > 0n ? Number((tokens * 10_000n) / bondedTotal) / 100 : 0);
	const pct = (x: number) => `${+(x * 100).toFixed(1)} %`;

	const list = $derived.by(() => {
		const q = query.trim().toLowerCase();
		// unstaking: only the validators you use
		const pool = mode === 'unstake' ? staking.delegations.map((d) => validatorOf(d.validator)).filter((x) => !!x) : staking.validators.filter((x) => x.bonded && !x.jailed);
		return pool.filter((x) => !q || x.moniker.toLowerCase().includes(q) || x.address.includes(q));
	});

	const available = $derived(mode === 'stake' ? spendable() : mine);
	const base = $derived.by(() => {
		if (!amount) return null;
		try {
			const b = toBaseUnits(amount.replace(',', '.'), 6);
			return b > 0n ? b : null;
		} catch {
			return null;
		}
	});
	const amountError = $derived(
		amount && base === null ? t('Enter a valid amount.') : base !== null && available !== null && base > available ? (mode === 'stake' ? t('More than your balance.') : t('More than you have staked here.')) : '',
	);
	const ready = $derived(!!validator && base !== null && !amountError);
	const backDate = $derived(new Date(Date.now() + staking.unbondingSeconds * 1000));

	function pick(address: string) {
		validator = address;
		suggested = false;
		amount = '';
		step = 'amount';
	}

	function startAmount(m: 'stake' | 'unstake') {
		mode = m;
		amount = '';
		step = 'amount';
	}

	async function submit() {
		if (!ready || base === null || sending) return;
		sending = true;
		failure = '';
		try {
			outcome = await (mode === 'stake' ? stake : unstake)(validator, base, (p) => (outcome = p));
		} catch (e) {
			haptic.error();
			failure =
				e instanceof NoGasError
					? t('Nothing can pay the network fee: gas credits are empty. See Settings → Gas credits.')
					: e instanceof BusyError || e instanceof Error
						? e.message
						: String(e);
		} finally {
			sending = false;
		}
	}

	const back = $derived.by(() => {
		if (outcome || sending) return undefined;
		if (step === 'review') return () => ((step = 'amount'), (failure = ''));
		if (step === 'amount') return initial && !initialMode ? () => (step = 'manage') : undefined;
		if (step === 'pick' && validator) return () => (step = 'amount');
		if (step === 'manage' && !initial) return () => (step = 'pick');
		return undefined;
	});
	const title = $derived(
		outcome || sending ? (mode === 'stake' ? t('Stake') : t('Unstake')) : step === 'pick' ? (mode === 'unstake' ? t('Unstake from') : t('Choose a validator')) : step === 'review' ? t('Confirm') : step === 'amount' ? (mode === 'unstake' ? t('Unstake') : t('Stake')) : (v?.moniker ?? t('Validator')),
	);
</script>

<Modal full {title} onclose={close} onback={back}>
	{#if outcome || sending}
		<TxStage
			{outcome}
			verbs={mode === 'stake' ? [t('Staking'), t('Staked')] : [t('Unstaking'), t('Unstaking started')]}
			{amount}
			unit="SCRT"
			sub={base !== null && fiatValue(base) ? `≈ ${fiatValue(base)}` : undefined}
			line={mode === 'stake' ? t('with {0}', { 0: v?.moniker ?? t('the validator') }) : t('from {0}', { 0: v?.moniker ?? t('the validator') })}
			summary={mode === 'stake'
				? `${t('Staked {0} SCRT with {1}.', { 0: amount, 1: v?.moniker ?? t('the validator') })}${wrapsReward ? t(' {0} SCRT of rewards went to your private balance.', { 0: formatAmount(wrapsReward) }) : ''}`
				: t('Unstaking {0} SCRT. It comes back on {1} as public SCRT.', { 0: amount, 1: backDate.toLocaleDateString() })}
			ondone={close}
		>
			{#snippet icon()}{#if mode === 'stake'}<Sprout size={30} />{:else}<Hourglass size={30} />{/if}{/snippet}
		</TxStage>
	{:else if step === 'pick'}
		<label class="flex items-center gap-2 rounded-pill bg-surface px-4 py-2.5">
			<Search size={16} class="shrink-0 text-text-faint" />
			<input bind:value={query} placeholder={t('Search validators')} aria-label={t('Search validators')} autocomplete="off" spellcheck="false" class="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-text-faint" />
		</label>
		{#if mode === 'stake'}<p class="-mt-2 px-1 text-label text-text-faint">{t('Validators run the network and pass rewards on to you, minus their fee. Smaller ones keep the network spread out.')}</p>{/if}
		{#if !staking.validators.length}
			<p class="text-base text-text-muted">{staking.error || t('Loading validators…')}</p>
		{/if}
		<ul class="-mt-2 flex flex-col">
			{#each list as x (x.address)}
				<li>
					<button type="button" onclick={() => pick(x.address)} class="state-layer -mx-2 flex w-[calc(100%+1rem)] items-center gap-4 rounded-card px-2 py-3.5 text-left">
						<ValidatorAvatar address={x.address} name={x.moniker} identity={x.identity} size={44} />
						<span class="min-w-0 flex-1">
							<span class="block truncate text-base font-medium">{x.moniker}</span>
							<span class="block truncate text-label text-text-faint">{mode === 'unstake' ? t('{0} SCRT staked', { 0: formatAmount(delegationTo(x.address), 2) }) : t('{0} fee · {1} % of the network', { 0: pct(x.commission), 1: share(x.tokens).toFixed(1) })}</span>
						</span>
						{#if mode === 'stake' && delegationTo(x.address) > 0n}<span class="shrink-0 rounded-pill bg-accent-soft px-2 py-0.5 text-[0.6875rem] font-medium text-accent">{t('Staked')}</span>{/if}
					</button>
				</li>
			{/each}
		</ul>
	{:else if step === 'manage'}
		<div class="flex flex-col items-center gap-2 pt-4 text-center">
			<ValidatorAvatar address={validator} name={v?.moniker ?? '?'} identity={v?.identity} size={72} />
			<h2 class="text-headline">{v?.moniker ?? validator}</h2>
			<p class="text-base text-text-muted">
				{t('{0} fee', { 0: pct(v?.commission ?? 0) })}{v?.bonded ? t(' · {0} % of the network', { 0: share(v.tokens).toFixed(1) }) : ''}
				{#if v?.jailed}<span class="block text-negative">{t('Jailed — this stake earns nothing. Consider unstaking.')}</span>{:else if v && !v.bonded}<span class="block text-negative">{t('Not in the active set — this stake earns nothing.')}</span>{/if}
			</p>
			{#if v?.website}
				<a href={v.website.startsWith('http') ? v.website : `https://${v.website}`} target="_blank" rel="noreferrer noopener" class="inline-flex items-center gap-1 text-label text-accent">
					{v.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
					<ExternalLink size={12} />
				</a>
			{/if}
		</div>
		<dl class="flex flex-col divide-y divide-border rounded-card border border-border bg-surface-1 text-base">
			<div class="flex justify-between gap-4 px-4 py-3.5"><dt class="text-text-faint">{t('Your stake')}</dt><dd class="tabular-nums">{formatAmount(mine)} SCRT</dd></div>
			<div class="flex justify-between gap-4 px-4 py-3.5"><dt class="text-text-faint">{t('Rewards')}</dt><dd class="tabular-nums text-positive">+{formatAmount(reward)} SCRT</dd></div>
		</dl>
		{#if v?.details}<p class="line-clamp-4 px-1 text-label text-text-faint">{v.details}</p>{/if}
		<div class="mt-auto grid grid-cols-2 gap-2 pt-4">
			<Button variant="secondary" size="lg" disabled={mine === 0n} onclick={() => startAmount('unstake')}>{t('Unstake')}</Button>
			<Button size="lg" disabled={!!v?.jailed || (v && !v.bonded)} onclick={() => startAmount('stake')}>{t('Stake more')}</Button>
		</div>
	{:else if step === 'amount'}
		{#if validator}
			<div class="flex items-center gap-3 rounded-card bg-surface px-3 py-2.5">
				<ValidatorAvatar address={validator} name={v?.moniker ?? '?'} identity={v?.identity} size={32} />
				<span class="min-w-0 flex-1">
					<span class="block truncate text-base font-medium">{v?.moniker ?? validator}</span>
					<span class="block truncate text-label text-text-faint">{suggested ? t('Suggested validator') : t('Validator')} · {t('{0} fee', { 0: pct(v?.commission ?? 0) })}</span>
				</span>
				{#if !initial && (mode === 'stake' || staking.delegations.length > 1)}<button type="button" class="px-1 text-label text-accent" onclick={() => (step = 'pick')}>{t('Change')}</button>{/if}
			</div>
		{:else}
			<div class="flex items-center gap-2 rounded-card bg-surface px-3 py-3.5 text-base text-text-muted">{t('Finding a validator…')}</div>
		{/if}
		<div class="flex flex-1 flex-col items-center justify-center gap-2">
			<AmountHero bind:amount symbol="SCRT" fiat max={() => available !== null && (amount = fromBaseUnits(available, 6))} />
			<p class="text-label text-text-faint">
				{#if mode === 'stake'}{t('{0} available', { 0: formatAmount(spendable()) })}{:else}{t('{0} SCRT staked with this validator', { 0: formatAmount(mine) })}{/if}
			</p>
			{#if amountError}<p class="text-label text-negative" role="alert">{amountError}</p>{/if}
		</div>
		{#if mode === 'unstake'}
			<p class="px-1 text-label text-text-faint">{t('It takes {0} days to come back and earns nothing meanwhile. Then you can move it to your private balance with one tap.', { 0: Math.round(staking.unbondingSeconds / 86_400) })}</p>
		{/if}
		<Button block size="xl" disabled={!ready} onclick={() => ((failure = ''), (step = 'review'))}>{!amount ? t('Enter an amount') : t('Review')}</Button>
	{:else}
		<div class="flex flex-col items-center gap-1 pt-6 text-center">
			<span class="text-label text-text-faint">{mode === 'stake' ? t("You're staking") : t("You're unstaking")}</span>
			<div class="flex items-baseline gap-2">
				<span class="text-[2.75rem] font-semibold leading-tight tracking-[-0.03em] tabular-nums">{amount}</span>
				<span class="text-title text-text-muted">SCRT</span>
			</div>
			{#if base !== null && fiatValue(base)}<span class="text-base tabular-nums text-text-faint">≈ {fiatValue(base)}</span>{/if}
		</div>
		<dl class="flex flex-col divide-y divide-border rounded-card border border-border bg-surface-1 text-base">
			<div class="flex items-start justify-between gap-4 px-4 py-3.5">
				<dt class="text-text-faint">{t('Validator')}</dt>
				<dd class="text-right">{v?.moniker ?? validator}<span class="block text-label text-text-faint">{t('{0} fee', { 0: pct(v?.commission ?? 0) })}</span></dd>
			</div>
			{#if mode === 'stake'}
				<div class="flex items-start justify-between gap-4 px-4 py-3.5">
					<dt class="text-text-faint">{t('From')}</dt>
					<dd class="text-right">{t('Your balance')}<span class="block text-label text-text-faint">{t('staked amounts are public on chain')}</span></dd>
				</div>
			{:else}
				<div class="flex items-start justify-between gap-4 px-4 py-3.5">
					<dt class="text-text-faint">{t('Back on')}</dt>
					<dd class="text-right">{backDate.toLocaleDateString()}<span class="block text-label text-text-faint">{t('in {0} days', { 0: Math.round(staking.unbondingSeconds / 86_400) })}</span></dd>
				</div>
			{/if}
			{#if wrapsReward}
				<div class="flex items-start justify-between gap-4 px-4 py-3.5">
					<dt class="text-text-faint">{t('Rewards')}</dt>
					<dd class="text-right tabular-nums text-positive">
						+{formatAmount(wrapsReward)} SCRT<span class="flex items-center justify-end gap-1 text-label text-text-faint"><ShieldCheck size={12} class="text-accent" /> {t('to your private balance')}</span>
					</dd>
				</div>
			{/if}
			{#if mode === 'stake' && totalStaked() === 0n}
				<div class="flex items-start justify-between gap-4 px-4 py-3.5"><dt class="text-text-faint">{t('Unstaking')}</dt><dd class="text-right">{t('takes {0} days', { 0: Math.round(staking.unbondingSeconds / 86_400) })}</dd></div>
			{/if}
			<div class="flex items-start justify-between gap-4 px-4 py-3.5"><dt class="text-text-faint">{t('Network fee')}</dt><dd class="text-right">{t('Paid from gas credits')}</dd></div>
		</dl>
		{#if failure}<p class="break-address text-base text-negative animate-[shake_400ms_var(--ease-standard)]" role="alert">{failure}</p>{/if}
		<div class="mt-auto pt-4">
			<SwipeConfirm label={mode === 'stake' ? t('Swipe to stake') : t('Swipe to unstake')} loading={sending} disabled={!ready && !sending} onconfirm={submit} />
		</div>
	{/if}
</Modal>
