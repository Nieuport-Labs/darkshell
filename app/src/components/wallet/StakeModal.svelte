<script lang="ts">
	// Stake (from sSCRT) or unstake with one validator: pick a validator, see
	// your stake with it, enter an amount, review, swipe. One transaction each.
	import { ExternalLink, Search, ShieldCheck } from '@lucide/svelte';
	import { fromBaseUnits, toBaseUnits } from 'secret-pay';
	import { untrack } from 'svelte';
	import { BusyError, type TxOutcome } from '../../lib/chain/tx';
	import { MIN_WRAP_REWARD } from '../../lib/chain/staking';
	import { formatAmount } from '../../lib/format';
	import { NoGasError } from '../../lib/gas/feePayer';
	import { usdValue } from '../../lib/price.svelte';
	import { delegationTo, loadStaking, rewardOf, stake, staking, totalStaked, unstake, validatorOf } from '../../lib/staking.svelte';
	import { close } from '../../lib/ui.svelte';
	import { prefetchForPayment, spendable, wallet } from '../../lib/wallet.svelte';
	import AmountHero from '../ui/AmountHero.svelte';
	import Button from '../ui/Button.svelte';
	import Modal from '../ui/Modal.svelte';
	import SwipeConfirm from '../ui/SwipeConfirm.svelte';
	import TxResult from './TxResult.svelte';
	import ValidatorAvatar from './ValidatorAvatar.svelte';

	let { validator: initial, mode: initialMode }: { validator?: string; mode?: 'stake' | 'unstake' } = $props();

	type Step = 'pick' | 'manage' | 'amount' | 'review';
	let validator = $state(untrack(() => initial ?? ''));
	let mode = $state<'stake' | 'unstake'>(untrack(() => initialMode ?? 'stake'));
	let step = $state<Step>(untrack(() => (!initial ? 'pick' : initialMode ? 'amount' : 'manage')));
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
		return staking.validators.filter((x) => x.bonded && !x.jailed && (!q || x.moniker.toLowerCase().includes(q) || x.address.includes(q)));
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
		amount && base === null ? 'Enter a valid amount.' : base !== null && available !== null && base > available ? (mode === 'stake' ? 'More than your balance.' : 'More than you have staked here.') : '',
	);
	const ready = $derived(!!validator && base !== null && !amountError);
	const backDate = $derived(new Date(Date.now() + staking.unbondingSeconds * 1000));

	function pick(address: string) {
		validator = address;
		step = delegationTo(address) > 0n ? 'manage' : 'amount';
		mode = 'stake';
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
			failure =
				e instanceof NoGasError
					? 'Nothing can pay the network fee: gas credits are empty. See Settings → Gas credits.'
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
		if (step === 'amount') return mine > 0n ? () => (step = 'manage') : initial ? undefined : () => (step = 'pick');
		if (step === 'manage' && !initial) return () => (step = 'pick');
		return undefined;
	});
	const title = $derived(outcome ? (mode === 'stake' ? 'Staked' : 'Unstaking') : step === 'pick' ? 'Choose a validator' : step === 'review' ? 'Confirm' : mode === 'unstake' && step === 'amount' ? 'Unstake' : step === 'amount' ? 'Stake' : (v?.moniker ?? 'Validator'));
</script>

<Modal full {title} onclose={close} onback={back}>
	{#if outcome}
		<TxResult
			{outcome}
			summary={mode === 'stake'
				? `Staked ${amount} SCRT with ${v?.moniker ?? 'the validator'}.${wrapsReward ? ` ${formatAmount(wrapsReward)} SCRT of rewards went to your private balance.` : ''}`
				: `Unstaking ${amount} SCRT. It comes back on ${backDate.toLocaleDateString()} as public SCRT.`}
			ondone={close}
		/>
	{:else if step === 'pick'}
		<label class="flex items-center gap-2 rounded-pill bg-surface px-4 py-2.5">
			<Search size={16} class="shrink-0 text-text-faint" />
			<input bind:value={query} placeholder="Search validators" aria-label="Search validators" autocomplete="off" spellcheck="false" class="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-text-faint" />
		</label>
		<p class="-mt-2 px-1 text-label text-text-faint">Sorted by voting power. Staking with smaller validators keeps the network decentralised.</p>
		{#if !staking.validators.length}
			<p class="text-base text-text-muted">{staking.error || 'Loading validators…'}</p>
		{/if}
		<ul class="-mt-2 flex flex-col">
			{#each list as x (x.address)}
				<li>
					<button type="button" onclick={() => pick(x.address)} class="state-layer -mx-2 flex w-[calc(100%+1rem)] items-center gap-4 rounded-card px-2 py-3.5 text-left">
						<ValidatorAvatar address={x.address} name={x.moniker} identity={x.identity} size={44} />
						<span class="min-w-0 flex-1">
							<span class="block truncate text-base font-medium">{x.moniker}</span>
							<span class="block truncate text-label text-text-faint">{pct(x.commission)} commission · {share(x.tokens).toFixed(1)} % of stake</span>
						</span>
						{#if delegationTo(x.address) > 0n}<span class="shrink-0 rounded-pill bg-accent-soft px-2 py-0.5 text-[0.6875rem] font-medium text-accent">Staked</span>{/if}
					</button>
				</li>
			{/each}
		</ul>
	{:else if step === 'manage'}
		<div class="flex flex-col items-center gap-2 pt-4 text-center">
			<ValidatorAvatar address={validator} name={v?.moniker ?? '?'} identity={v?.identity} size={72} />
			<h2 class="text-headline">{v?.moniker ?? validator}</h2>
			<p class="text-base text-text-muted">
				{pct(v?.commission ?? 0)} commission{v?.bonded ? ` · ${share(v.tokens).toFixed(1)} % of stake` : ''}
				{#if v?.jailed}<span class="block text-negative">Jailed — this stake earns nothing. Consider unstaking.</span>{:else if v && !v.bonded}<span class="block text-negative">Not in the active set — this stake earns nothing.</span>{/if}
			</p>
			{#if v?.website}
				<a href={v.website.startsWith('http') ? v.website : `https://${v.website}`} target="_blank" rel="noreferrer noopener" class="inline-flex items-center gap-1 text-label text-accent">
					{v.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
					<ExternalLink size={12} />
				</a>
			{/if}
		</div>
		<dl class="flex flex-col divide-y divide-border rounded-card border border-border bg-surface-1 text-base">
			<div class="flex justify-between gap-4 px-4 py-3.5"><dt class="text-text-faint">Your stake</dt><dd class="tabular-nums">{formatAmount(mine)} SCRT</dd></div>
			<div class="flex justify-between gap-4 px-4 py-3.5"><dt class="text-text-faint">Rewards</dt><dd class="tabular-nums text-positive">+{formatAmount(reward)} SCRT</dd></div>
		</dl>
		{#if v?.details}<p class="line-clamp-4 px-1 text-label text-text-faint">{v.details}</p>{/if}
		<div class="mt-auto grid grid-cols-2 gap-2 pt-4">
			<Button variant="secondary" size="lg" disabled={mine === 0n} onclick={() => startAmount('unstake')}>Unstake</Button>
			<Button size="lg" disabled={!!v?.jailed || (v && !v.bonded)} onclick={() => startAmount('stake')}>Stake more</Button>
		</div>
	{:else if step === 'amount'}
		<div class="flex items-center gap-3 rounded-card bg-surface px-3 py-2.5">
			<ValidatorAvatar address={validator} name={v?.moniker ?? '?'} identity={v?.identity} size={32} />
			<span class="min-w-0 flex-1 truncate text-base font-medium">{v?.moniker ?? validator}</span>
			{#if !initial || mine > 0n}<button type="button" class="text-label text-accent" onclick={() => (step = initial && mine > 0n ? 'manage' : 'pick')}>Change</button>{/if}
		</div>
		<div class="flex flex-1 flex-col items-center justify-center gap-2">
			<AmountHero bind:amount symbol="SCRT" fiat max={() => available !== null && (amount = fromBaseUnits(available, 6))} />
			<p class="text-label text-text-faint">
				{#if mode === 'stake'}{formatAmount(spendable())} available{:else}{formatAmount(mine)} SCRT staked with this validator{/if}
			</p>
			{#if amountError}<p class="text-label text-negative" role="alert">{amountError}</p>{/if}
		</div>
		{#if mode === 'unstake'}
			<p class="px-1 text-label text-text-faint">Unstaked SCRT earns nothing and can't be moved for {Math.round(staking.unbondingSeconds / 86_400)} days. Then it comes back as public SCRT.</p>
		{/if}
		<Button block size="xl" disabled={!ready} onclick={() => ((failure = ''), (step = 'review'))}>{!amount ? 'Enter an amount' : 'Review'}</Button>
	{:else}
		<div class="flex flex-col items-center gap-1 pt-6 text-center">
			<span class="text-label text-text-faint">{mode === 'stake' ? "You're staking" : "You're unstaking"}</span>
			<div class="flex items-baseline gap-2">
				<span class="text-[2.75rem] font-semibold leading-tight tracking-[-0.03em] tabular-nums">{amount}</span>
				<span class="text-title text-text-muted">SCRT</span>
			</div>
			{#if base !== null && usdValue(base)}<span class="text-base tabular-nums text-text-faint">≈ {usdValue(base)}</span>{/if}
		</div>
		<dl class="flex flex-col divide-y divide-border rounded-card border border-border bg-surface-1 text-base">
			<div class="flex items-start justify-between gap-4 px-4 py-3.5">
				<dt class="text-text-faint">Validator</dt>
				<dd class="text-right">{v?.moniker ?? validator}<span class="block text-label text-text-faint">{pct(v?.commission ?? 0)} commission</span></dd>
			</div>
			{#if mode === 'stake'}
				<div class="flex items-start justify-between gap-4 px-4 py-3.5">
					<dt class="text-text-faint">From</dt>
					<dd class="text-right">Private balance<span class="block text-label text-text-faint">unwrapped and staked in one transaction</span></dd>
				</div>
			{:else}
				<div class="flex items-start justify-between gap-4 px-4 py-3.5">
					<dt class="text-text-faint">Back on</dt>
					<dd class="text-right">{backDate.toLocaleDateString()}<span class="block text-label text-text-faint">as public SCRT</span></dd>
				</div>
			{/if}
			{#if wrapsReward}
				<div class="flex items-start justify-between gap-4 px-4 py-3.5">
					<dt class="text-text-faint">Rewards</dt>
					<dd class="text-right tabular-nums text-positive">
						+{formatAmount(wrapsReward)} SCRT<span class="flex items-center justify-end gap-1 text-label text-text-faint"><ShieldCheck size={12} class="text-accent" /> to your private balance</span>
					</dd>
				</div>
			{/if}
			{#if mode === 'stake' && totalStaked() === 0n}
				<div class="flex items-start justify-between gap-4 px-4 py-3.5"><dt class="text-text-faint">Unstaking</dt><dd class="text-right">takes {Math.round(staking.unbondingSeconds / 86_400)} days</dd></div>
			{/if}
			<div class="flex items-start justify-between gap-4 px-4 py-3.5"><dt class="text-text-faint">Network fee</dt><dd class="text-right">Paid from gas credits</dd></div>
		</dl>
		{#if failure}<p class="break-address text-base text-negative" role="alert">{failure}</p>{/if}
		<div class="mt-auto pt-4">
			<SwipeConfirm label={mode === 'stake' ? 'Swipe to stake' : 'Swipe to unstake'} loading={sending} disabled={!ready && !sending} onconfirm={submit} />
		</div>
	{/if}
</Modal>
