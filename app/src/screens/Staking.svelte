<script lang="ts">
	// Staking and governance. Staking works from the private balance: sSCRT is
	// unwrapped and delegated in one transaction; claimed rewards go straight
	// back into sSCRT; unstaked SCRT comes back public after 21 days and is made
	// private with one tap.
	import { ChevronRight, Landmark, Loader2, Plus, ShieldCheck } from '@lucide/svelte';
	import PageHeader from '../components/ui/PageHeader.svelte';
	import Button from '../components/ui/Button.svelte';
	import ValidatorAvatar from '../components/wallet/ValidatorAvatar.svelte';
	import { STATUS_LABELS, timeLeft, VOTE_LABELS } from '../lib/chain/governance';
	import type { TxOutcome } from '../lib/chain/tx';
	import { formatAmount } from '../lib/format';
	import { usdValue } from '../lib/price.svelte';
	import { claimAll, loadGovernance, loadStaking, rewardOf, staking, totalRewards, totalStaked, validatorName, validatorOf } from '../lib/staking.svelte';
	import { kv } from '../lib/storage';
	import { open, ui } from '../lib/ui.svelte';
	import { wallet, wrapPublic } from '../lib/wallet.svelte';

	let view = $state<'staking' | 'governance'>('staking');
	void kv.get<'staking' | 'governance'>('staking.view').then((v) => v && (view = v));

	$effect(() => {
		void wallet.address; // reload on account switch
		void loadStaking();
	});
	$effect(() => {
		if (view === 'governance') void loadGovernance();
	});

	function show(v: typeof view) {
		view = v;
		void kv.set('staking.view', v);
	}

	const staked = $derived(totalStaked());
	const rewards = $derived(totalRewards());
	const publicScrt = $derived(wallet.native !== null && wallet.native > 100_000n ? wallet.native : null);
	const openProposals = $derived(staking.proposals.filter((p) => p.status === 'PROPOSAL_STATUS_VOTING_PERIOD' || p.status === 'PROPOSAL_STATUS_DEPOSIT_PERIOD'));
	const pastProposals = $derived(staking.proposals.filter((p) => !openProposals.includes(p)).slice(0, 20));
	const hide = (s: string) => (ui.hideBalance ? '••••' : s);

	let claiming = $state(false);
	let claimMsg = $state('');
	async function claim() {
		claiming = true;
		claimMsg = '';
		try {
			const out: TxOutcome = await claimAll();
			claimMsg = out.status === 'confirmed' ? 'Rewards are in your private balance.' : 'Sent; waiting for confirmation.';
		} catch (e) {
			claimMsg = e instanceof Error ? e.message : String(e);
		} finally {
			claiming = false;
		}
	}

	let wrapping = $state(false);
	let wrapMsg = $state('');
	async function makePrivate() {
		wrapping = true;
		wrapMsg = '';
		try {
			const out = await wrapPublic();
			wrapMsg = out.status === 'confirmed' ? 'Moved into your private balance.' : 'Sent; waiting for confirmation.';
		} catch (e) {
			wrapMsg = e instanceof Error ? e.message : String(e);
		} finally {
			wrapping = false;
		}
	}

	function days(d: Date): string {
		const n = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
		return n <= 0 ? 'any moment' : n === 1 ? 'tomorrow' : `in ${n} days`;
	}
	const pct = (x: number) => `${+(x * 100).toFixed(1)} %`;
</script>

<div class="flex flex-col gap-7">
	<PageHeader title="Earn" />

	<div class="-mt-5 grid grid-cols-2 gap-1 rounded-pill bg-surface p-1" role="tablist">
		{#each [['staking', 'Staking'], ['governance', 'Governance']] as [v, label] (v)}
			<button
				type="button"
				role="tab"
				aria-selected={view === v}
				onclick={() => show(v as typeof view)}
				class="rounded-pill py-2 text-base font-medium transition-colors duration-200 {view === v ? 'bg-surface-3 text-text' : 'text-text-muted'}">{label}</button
			>
		{/each}
	</div>

	{#if view === 'staking'}
		<section class="flex flex-col items-start gap-1 px-1 pt-2">
			<span class="text-label text-text-faint">Staked</span>
			<div class="flex items-baseline gap-2">
				<span class="text-[2.5rem] font-semibold leading-none tracking-[-0.03em] tabular-nums">{staking.loaded ? hide(formatAmount(staked, 2)) : '—'}</span>
				<span class="text-title text-text-muted">SCRT</span>
			</div>
			<span class="text-base text-text-faint">
				{#if staking.loaded && staked > 0n && usdValue(staked) && !ui.hideBalance}≈ {usdValue(staked)} ·{/if}
				{staking.apr ? `≈ ${pct(staking.apr)} a year` : 'Earn SCRT for securing the network'}
			</span>
		</section>

		{#if rewards > 0n}
			<div class="flex items-center justify-between gap-3 rounded-card border border-border bg-surface-1 px-4 py-3">
				<span class="min-w-0">
					<span class="block text-label text-text-faint">Rewards</span>
					<span class="block text-title tabular-nums text-positive">+{hide(formatAmount(rewards, 6))} SCRT</span>
				</span>
				<Button variant="soft" size="sm" loading={claiming} onclick={claim}>
					{#snippet icon()}<ShieldCheck size={15} />{/snippet}
					Claim to private
				</Button>
			</div>
			{#if claimMsg}<p class="-mt-5 px-1 text-label text-text-faint">{claimMsg}</p>{/if}
		{/if}

		{#if publicScrt}
			<div class="flex items-center justify-between gap-3 rounded-card border border-border bg-surface-1 px-4 py-3">
				<span class="min-w-0">
					<span class="block text-label text-text-faint">Unstaked, public</span>
					<span class="block text-title tabular-nums">{hide(formatAmount(publicScrt))} SCRT</span>
				</span>
				<Button variant="soft" size="sm" loading={wrapping} onclick={makePrivate}>
					{#snippet icon()}<ShieldCheck size={15} />{/snippet}
					Make private
				</Button>
			</div>
			{#if wrapMsg}<p class="-mt-5 px-1 text-label text-text-faint">{wrapMsg}</p>{/if}
		{/if}

		<Button block size="lg" onclick={() => open({ name: 'stake' })}>
			{#snippet icon()}<Plus size={18} />{/snippet}
			Stake from private balance
		</Button>

		{#if staking.error && !staking.loaded}
			<p class="text-base text-negative">{staking.error}</p>
		{:else if !staking.loaded}
			<div class="flex items-center gap-2 text-base text-text-muted"><Loader2 size={16} class="animate-spin" /> Loading…</div>
		{:else}
			{#if staking.delegations.length}
				<section class="flex flex-col">
					<h2 class="pb-2 text-title">Your validators</h2>
					<ul class="flex flex-col gap-1">
						{#each staking.delegations as d (d.validator)}
							{@const v = validatorOf(d.validator)}
							{@const r = rewardOf(d.validator)}
							<li>
								<button
									type="button"
									onclick={() => open({ name: 'stake', validator: d.validator })}
									class="state-layer -mx-2 flex w-[calc(100%+1rem)] items-center gap-4 rounded-card px-2 py-3.5 text-left"
								>
									<ValidatorAvatar address={d.validator} name={validatorName(d.validator)} identity={v?.identity} size={44} />
									<span class="min-w-0 flex-1">
										<span class="block truncate text-base font-medium">{validatorName(d.validator)}</span>
										<span class="block truncate text-label {v?.jailed || (v && !v.bonded) ? 'text-negative' : 'text-text-faint'}">
											{v?.jailed ? 'Jailed — not earning' : v && !v.bonded ? 'Inactive — not earning' : `${pct(v?.commission ?? 0)} commission`}
										</span>
									</span>
									<span class="flex shrink-0 flex-col items-end">
										<span class="text-base font-medium tabular-nums">{hide(formatAmount(d.amount, 2))}</span>
										{#if r > 0n}<span class="text-label tabular-nums text-positive">+{hide(formatAmount(r, 4))}</span>{/if}
									</span>
									<ChevronRight size={16} class="shrink-0 text-text-faint" />
								</button>
							</li>
						{/each}
					</ul>
				</section>
			{:else}
				<div class="flex flex-col items-center gap-2 px-6 py-6 text-center">
					<span class="flex size-12 items-center justify-center rounded-pill bg-accent-soft text-accent"><Landmark size={22} /></span>
					<p class="text-base text-text-muted">
						Stake sSCRT with a validator to earn rewards and vote on proposals. Unstaking takes {Math.round(staking.unbondingSeconds / 86_400)} days.
					</p>
				</div>
			{/if}

			{#if staking.unbondings.length}
				<section class="flex flex-col">
					<h2 class="pb-2 text-title">Unstaking</h2>
					<ul class="flex flex-col">
						{#each staking.unbondings as u, i (`${u.validator}-${i}`)}
							<li class="flex items-center gap-4 py-3">
								<ValidatorAvatar address={u.validator} name={validatorName(u.validator)} identity={validatorOf(u.validator)?.identity} size={44} />
								<span class="min-w-0 flex-1">
									<span class="block truncate text-base font-medium">{validatorName(u.validator)}</span>
									<span class="block text-label text-text-faint">Back {days(u.completesAt)} · {u.completesAt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
								</span>
								<span class="shrink-0 text-base tabular-nums">{hide(formatAmount(u.amount, 2))}</span>
							</li>
						{/each}
					</ul>
					<p class="pt-1 text-label text-text-faint">It comes back as public SCRT; you'll be offered to make it private.</p>
				</section>
			{/if}
		{/if}
	{:else}
		{#if staking.govError && !staking.proposals.length}
			<p class="text-base text-negative">{staking.govError}</p>
		{:else if !staking.proposals.length}
			<div class="flex items-center gap-2 text-base text-text-muted"><Loader2 size={16} class="animate-spin" /> Loading proposals…</div>
		{:else}
			{#if staking.loaded && totalStaked() === 0n}
				<p class="px-1 text-base text-text-muted">Votes are weighted by staked SCRT. Stake first to have a say.</p>
			{/if}
			{#snippet proposalRow(p: (typeof staking.proposals)[number])}
				{@const mine = staking.votes[p.id]}
				{@const tone =
					p.status === 'PROPOSAL_STATUS_VOTING_PERIOD'
						? 'text-accent'
						: p.status === 'PROPOSAL_STATUS_PASSED'
							? 'text-positive'
							: p.status === 'PROPOSAL_STATUS_REJECTED' || p.status === 'PROPOSAL_STATUS_FAILED'
								? 'text-negative'
								: 'text-text-faint'}
				<li>
					<button type="button" onclick={() => open({ name: 'proposal', id: p.id })} class="state-layer -mx-3 flex w-[calc(100%+1.5rem)] items-center gap-4 rounded-card px-3 py-4 text-left">
						<span class="min-w-0 flex-1">
							<span class="line-clamp-2 text-base font-medium leading-snug [overflow-wrap:anywhere]">{p.title}</span>
							<span class="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-label text-text-faint">
								<span class={tone}>{STATUS_LABELS[p.status]}</span>
								{#if timeLeft(p)}<span>·</span><span>{timeLeft(p)}</span>{/if}
								{#if mine}<span>·</span><span class="text-accent">You voted {VOTE_LABELS[mine]}</span>{/if}
							</span>
						</span>
						<ChevronRight size={16} class="shrink-0 text-text-faint" />
					</button>
				</li>
			{/snippet}
			{#if openProposals.length}
				<section class="flex flex-col">
					<h2 class="pb-1 text-title">Open for voting</h2>
					<ul class="flex flex-col divide-y divide-border">{#each openProposals as p (p.id)}{@render proposalRow(p)}{/each}</ul>
				</section>
			{:else}
				<p class="text-base text-text-muted">No proposal is open for voting right now.</p>
			{/if}
			<section class="flex flex-col">
				<h2 class="pb-1 text-title">Recent</h2>
				<ul class="flex flex-col divide-y divide-border">{#each pastProposals as p (p.id)}{@render proposalRow(p)}{/each}</ul>
			</section>
		{/if}
	{/if}
</div>
