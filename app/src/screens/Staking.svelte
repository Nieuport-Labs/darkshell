<script lang="ts">
	// Staking and governance. Staking works from the private balance: sSCRT is
	// unwrapped and delegated in one transaction; claimed rewards go straight
	// back into sSCRT; unstaked SCRT comes back public after 21 days and is made
	// private with one tap.
	import { ChevronRight, Loader2, Minus, Plus, ShieldCheck } from '@lucide/svelte';
	import PageHeader from '../components/ui/PageHeader.svelte';
	import Button from '../components/ui/Button.svelte';
	import ValidatorAvatar from '../components/wallet/ValidatorAvatar.svelte';
	import { STATUS_LABELS, timeLeft, VOTE_LABELS } from '../lib/chain/governance';
	import { formatAmount } from '../lib/format';
	import { usdValue } from '../lib/price.svelte';
	import { loadGovernance, loadStaking, staking, totalRewards, totalStaked, validatorName, validatorOf } from '../lib/staking.svelte';
	import { kv } from '../lib/storage';
	import { open, ui } from '../lib/ui.svelte';
	import { wallet } from '../lib/wallet.svelte';

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

	function days(d: Date): string {
		const n = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
		return n <= 0 ? 'any moment' : n === 1 ? 'tomorrow' : `in ${n} days`;
	}
	const pct = (x: number) => `${+(x * 100).toFixed(1)} %`;
</script>

<div class="flex flex-col gap-7">
	<PageHeader title="Earn" />

	<div class="-mt-5 grid grid-cols-2 gap-1 rounded-pill bg-surface p-1" role="tablist">
		{#each [['staking', 'Staking'], ['governance', 'Vote']] as [v, label] (v)}
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
		<!-- what you have staked and what it earns: one card -->
		<section class="flex flex-col gap-4 rounded-card border border-border bg-surface-1 p-5">
			<div class="flex flex-col gap-1">
				<span class="text-label text-text-faint">Staked</span>
				<div class="flex items-baseline gap-2">
					<span class="text-[2.5rem] font-semibold leading-none tracking-[-0.03em] tabular-nums">{staking.loaded ? hide(formatAmount(staked, 2)) : '—'}</span>
					<span class="text-title text-text-muted">SCRT</span>
				</div>
				<span class="text-base text-text-faint">
					{#if staking.apr}Earns ≈ {pct(staking.apr)} a year{:else}Earn SCRT for helping run the network{/if}{#if staking.loaded && staked > 0n && usdValue(staked) && !ui.hideBalance}
						· ≈ {usdValue(staked)}{/if}
				</span>
			</div>
			{#if rewards > 0n}
				<div class="flex items-center justify-between gap-3 border-t border-border pt-4">
					<span class="min-w-0">
						<span class="block text-label text-text-faint">Earned so far</span>
						<span class="block text-title tabular-nums text-positive">+{hide(formatAmount(rewards, 6))} SCRT</span>
					</span>
					<Button variant="soft" size="sm" onclick={() => open({ name: 'action', action: 'claim' })}>Collect</Button>
				</div>
			{/if}
		</section>
		{#if rewards > 0n}<p class="-mt-5 px-1 text-label text-text-faint">Already counted in your balance; collected for you whenever you pay.</p>{/if}

		<div class="grid gap-3 {staked > 0n ? 'grid-cols-2' : 'grid-cols-1'}">
			<Button block size="lg" onclick={() => open({ name: 'stake', mode: 'stake' })}>
				{#snippet icon()}<Plus size={18} />{/snippet}
				Stake
			</Button>
			{#if staked > 0n}
				<Button variant="secondary" block size="lg" onclick={() => open({ name: 'stake', mode: 'unstake' })}>
					{#snippet icon()}<Minus size={18} />{/snippet}
					Unstake
				</Button>
			{/if}
		</div>

		{#if publicScrt}
			<div class="flex items-center justify-between gap-3 rounded-card border border-border bg-surface-1 px-4 py-3">
				<span class="min-w-0">
					<span class="block text-label text-text-faint">Public SCRT, not private yet</span>
					<span class="block text-title tabular-nums">{hide(formatAmount(publicScrt))} SCRT</span>
				</span>
				<Button variant="soft" size="sm" onclick={() => open({ name: 'action', action: 'wrap' })}>
					{#snippet icon()}<ShieldCheck size={15} />{/snippet}
					Make private
				</Button>
			</div>
		{/if}

		{#if staking.error && !staking.loaded}
			<p class="text-base text-negative">{staking.error}</p>
		{:else if !staking.loaded}
			<div class="flex items-center gap-2 text-base text-text-muted"><Loader2 size={16} class="animate-spin" /> Loading…</div>
		{:else}
			{#if staking.unbondings.length}
				<section class="flex flex-col">
					<h2 class="pb-1 text-title">On the way back</h2>
					<ul class="flex flex-col divide-y divide-border">
						{#each staking.unbondings as u, i (`${u.validator}-${i}`)}
							<li class="flex items-center justify-between gap-4 py-3">
								<span class="text-base tabular-nums">{hide(formatAmount(u.amount, 2))} SCRT</span>
								<span class="text-label text-text-faint">{days(u.completesAt)} · {u.completesAt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if staking.delegations.length}
				<section class="flex flex-col">
					<h2 class="pb-1 text-title">Staked with</h2>
					<ul class="flex flex-col">
						{#each staking.delegations as d (d.validator)}
							{@const v = validatorOf(d.validator)}
							{@const idle = !!v && (v.jailed || !v.bonded)}
							<li>
								<button
									type="button"
									onclick={() => open({ name: 'stake', validator: d.validator })}
									class="state-layer -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-card px-2 py-3 text-left"
								>
									<ValidatorAvatar address={d.validator} name={validatorName(d.validator)} identity={v?.identity} size={36} />
									<span class="min-w-0 flex-1">
										<span class="block truncate text-base">{validatorName(d.validator)}</span>
										{#if idle}<span class="block truncate text-label text-negative">Not earning — consider unstaking</span>{/if}
									</span>
									<span class="shrink-0 text-base tabular-nums text-text-muted">{hide(formatAmount(d.amount, 2))}</span>
									<ChevronRight size={16} class="shrink-0 text-text-faint" />
								</button>
							</li>
						{/each}
					</ul>
				</section>
			{:else}
				<ol class="flex flex-col gap-3 px-1 text-base text-text-muted">
					<li class="flex gap-3"><span class="flex size-6 shrink-0 items-center justify-center rounded-pill bg-accent-soft text-label text-accent">1</span>Stake part of your balance. A validator is picked for you.</li>
					<li class="flex gap-3"><span class="flex size-6 shrink-0 items-center justify-center rounded-pill bg-accent-soft text-label text-accent">2</span>It earns SCRT every few seconds; you see it grow in your balance.</li>
					<li class="flex gap-3"><span class="flex size-6 shrink-0 items-center justify-center rounded-pill bg-accent-soft text-label text-accent">3</span>Unstake any time; it takes {Math.round(staking.unbondingSeconds / 86_400)} days to come back.</li>
				</ol>
			{/if}
		{/if}
	{:else}
		{#if staking.govError && !staking.proposals.length}
			<p class="text-base text-negative">{staking.govError}</p>
		{:else if !staking.proposals.length}
			<div class="flex items-center gap-2 text-base text-text-muted"><Loader2 size={16} class="animate-spin" /> Loading proposals…</div>
		{:else}
			{#if staking.loaded && totalStaked() === 0n}
				<p class="px-1 text-base text-text-muted">Stakers decide how Secret Network changes. Stake first to vote; your vote counts by how much you stake.</p>
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
