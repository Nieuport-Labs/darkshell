<script lang="ts">
	// One governance proposal: what it would do, the live tally against the
	// chain's three tests, and a vote (weighted by this account's stake):
	// pick an option, review it, swipe.
	import { Check, Loader2 } from '@lucide/svelte';
	import {
		evaluate,
		messageTypeLabel,
		queryBondedTokens,
		queryGovParams,
		queryProposal,
		queryTally,
		STATUS_LABELS,
		timeLeft,
		VOTE_LABELS,
		type GovParams,
		type Proposal,
		type Tally,
		type VoteOption,
	} from '../../lib/chain/governance';
	import { BusyError, type TxOutcome } from '../../lib/chain/tx';
	import { formatAmount } from '../../lib/format';
	import { NoGasError } from '../../lib/gas/feePayer';
	import { loadStaking, staking, totalStaked, vote } from '../../lib/staking.svelte';
	import { close } from '../../lib/ui.svelte';
	import { client, prefetchForPayment } from '../../lib/wallet.svelte';
	import Button from '../ui/Button.svelte';
	import Modal from '../ui/Modal.svelte';
	import SwipeConfirm from '../ui/SwipeConfirm.svelte';
	import TxResult from './TxResult.svelte';

	let { id }: { id: string } = $props();

	let proposal = $state<Proposal | undefined>(staking.proposals.find((p) => p.id === id));
	let tally = $state<Tally | null>(null);
	let params = $state<GovParams | null>(null);
	let bonded = $state(0n);
	let error = $state('');
	let choice = $state<VoteOption | null>(null);
	let sending = $state(false);
	let failure = $state('');
	let outcome = $state<TxOutcome | null>(null);
	let expanded = $state(false);
	let reviewing = $state(false);

	if (!staking.loaded) void loadStaking();
	prefetchForPayment();

	void (async () => {
		try {
			const c = client();
			const p = proposal ?? (await queryProposal(c, id));
			proposal = p;
			if (!p) return void (error = 'This proposal could not be found.');
			const live = p.status === 'PROPOSAL_STATUS_VOTING_PERIOD';
			const [t, gp, b] = await Promise.all([live ? queryTally(c, id) : Promise.resolve(p.finalTally), queryGovParams(c), queryBondedTokens(c)]);
			tally = t;
			params = gp;
			bonded = b;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	})();

	const isOpen = $derived(proposal?.status === 'PROPOSAL_STATUS_VOTING_PERIOD');
	const mine = $derived(staking.votes[id]);
	const power = $derived(totalStaked());
	const outcomeNow = $derived(tally && params && proposal ? evaluate(tally, bonded, params, proposal.expedited) : undefined);
	const voted = $derived(tally ? tally.yes + tally.no + tally.veto + tally.abstain : 0n);
	const share = (x: bigint) => (voted > 0n ? Number((x * 1000n) / voted) / 10 : 0);
	const pct = (x: number) => `${(x * 100).toFixed(1)} %`;

	const OPTIONS: VoteOption[] = ['YES', 'NO', 'NO_WITH_VETO', 'ABSTAIN'];
	const BAR: Record<VoteOption, string> = { YES: 'bg-positive', NO: 'bg-negative', NO_WITH_VETO: 'bg-[#b45309]', ABSTAIN: 'bg-text-faint' };
	const counts = $derived(tally ? ({ YES: tally.yes, NO: tally.no, NO_WITH_VETO: tally.veto, ABSTAIN: tally.abstain } as Record<VoteOption, bigint>) : null);

	async function submit() {
		if (!choice || sending) return;
		sending = true;
		failure = '';
		try {
			outcome = await vote(id, choice, (p) => (outcome = p));
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
</script>

<Modal full title={reviewing && !outcome ? 'Confirm vote' : `Proposal #${id}`} onclose={close} onback={reviewing && !outcome && !sending ? () => ((reviewing = false), (failure = '')) : undefined}>
	{#if outcome && choice}
		<TxResult {outcome} summary="You voted {VOTE_LABELS[choice]} on proposal #{id}." ondone={close} />
	{:else if reviewing && choice && proposal}
		<div class="flex flex-col items-center gap-1 pt-6 text-center">
			<span class="text-label text-text-faint">You're voting</span>
			<span class="text-[2.5rem] font-semibold leading-tight tracking-[-0.03em]">{VOTE_LABELS[choice]}</span>
			{#if mine && mine !== choice}<span class="text-base text-text-faint">instead of {VOTE_LABELS[mine]}</span>{/if}
		</div>
		<dl class="flex flex-col divide-y divide-border rounded-card border border-border bg-surface-1 text-base">
			<div class="flex items-start justify-between gap-4 px-4 py-3.5">
				<dt class="shrink-0 text-text-faint">Proposal</dt>
				<dd class="min-w-0 text-right [overflow-wrap:anywhere]">#{id} · {proposal.title}</dd>
			</div>
			<div class="flex items-start justify-between gap-4 px-4 py-3.5">
				<dt class="text-text-faint">Weight</dt>
				<dd class="text-right tabular-nums">{formatAmount(power, 2)} SCRT<span class="block text-label text-text-faint">your staked SCRT</span></dd>
			</div>
			{#if timeLeft(proposal)}
				<div class="flex items-start justify-between gap-4 px-4 py-3.5"><dt class="text-text-faint">Voting</dt><dd class="text-right">{timeLeft(proposal)}<span class="block text-label text-text-faint">you can change your vote until then</span></dd></div>
			{/if}
			<div class="flex items-start justify-between gap-4 px-4 py-3.5"><dt class="text-text-faint">Visible</dt><dd class="text-right">Public<span class="block text-label text-text-faint">votes are public on chain</span></dd></div>
			<div class="flex items-start justify-between gap-4 px-4 py-3.5"><dt class="text-text-faint">Network fee</dt><dd class="text-right">Paid from gas credits</dd></div>
		</dl>
		{#if failure}<p class="break-address text-base text-negative" role="alert">{failure}</p>{/if}
		<div class="mt-auto pt-4">
			<SwipeConfirm label="Swipe to vote {VOTE_LABELS[choice]}" loading={sending} onconfirm={submit} />
		</div>
	{:else if !proposal}
		<p class="text-base {error ? 'text-negative' : 'text-text-muted'}">{error || 'Loading…'}</p>
	{:else}
		<div class="flex flex-col gap-2">
			<span class="flex flex-wrap items-center gap-2 text-label">
				<span class="rounded-pill bg-surface px-2.5 py-1 {isOpen ? 'text-accent' : proposal.status === 'PROPOSAL_STATUS_PASSED' ? 'text-positive' : 'text-text-muted'}">{STATUS_LABELS[proposal.status]}</span>
				{#if proposal.expedited}<span class="rounded-pill bg-surface px-2.5 py-1 text-text-muted">Expedited</span>{/if}
				{#if timeLeft(proposal)}<span class="text-text-faint">{timeLeft(proposal)}</span>{:else if proposal.votingEndTime}<span class="text-text-faint">Ended {proposal.votingEndTime.toLocaleDateString()}</span>{/if}
			</span>
			<h2 class="text-headline [overflow-wrap:anywhere]">{proposal.title}</h2>
			{#if proposal.messageTypes.length}
				<p class="text-label text-text-faint">Would run: {[...new Set(proposal.messageTypes.map(messageTypeLabel))].join(', ')}</p>
			{:else}
				<p class="text-label text-text-faint">Text proposal (runs nothing on chain)</p>
			{/if}
		</div>

		<!-- the tally against the chain's tests -->
		<section class="flex flex-col gap-3 rounded-card border border-border bg-surface-1 p-4">
			{#if !counts}
				<span class="flex items-center gap-2 text-base text-text-muted"><Loader2 size={15} class="animate-spin" /> Counting votes…</span>
			{:else}
				<div class="flex h-2 overflow-hidden rounded-pill bg-surface-3">
					{#each OPTIONS as o (o)}<span class={BAR[o]} style="width: {share(counts[o])}%"></span>{/each}
				</div>
				<ul class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-base">
					{#each OPTIONS as o (o)}
						<li class="flex items-center gap-2">
							<span class="size-2 shrink-0 rounded-pill {BAR[o]}"></span>
							<span class="flex-1 text-text-muted">{VOTE_LABELS[o]}</span>
							<span class="tabular-nums">{share(counts[o]).toFixed(1)} %</span>
						</li>
					{/each}
				</ul>
				<!-- turnout is measured against today's stake, so it only means something while voting is open -->
				{#if outcomeNow && isOpen}
					<p class="text-label text-text-faint">
						Turnout {pct(outcomeNow.turnout)} of staked SCRT (quorum {pct(outcomeNow.quorum)}).
						{outcomeNow.passing ? 'Passing' : outcomeNow.vetoed ? 'Vetoed' : !outcomeNow.quorumMet ? 'Below quorum' : 'Not passing'} if it closed now.
					</p>
				{/if}
			{/if}
		</section>

		{#if proposal.summary}
			<section class="flex flex-col gap-1">
				<!-- the proposer's text: plain text only, never HTML or links -->
				<p class="whitespace-pre-wrap break-words text-base text-text-muted {expanded ? '' : 'line-clamp-6'}">{proposal.summary}</p>
				{#if proposal.summary.length > 320}
					<button type="button" class="self-start text-label text-accent" onclick={() => (expanded = !expanded)}>{expanded ? 'Show less' : 'Read all'}</button>
				{/if}
			</section>
		{/if}

		{#if isOpen}
			<section class="mt-auto flex flex-col gap-3 pt-2">
				<h3 class="text-title">{mine ? `You voted ${VOTE_LABELS[mine]}` : 'Your vote'}</h3>
				{#if staking.loaded && power === 0n}
					<p class="text-base text-text-muted">Votes are weighted by staked SCRT, and this account has none staked. Stake first to vote.</p>
				{:else}
					<div class="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Vote">
						{#each OPTIONS as o (o)}
							<button
								type="button"
								role="radio"
								aria-checked={choice === o}
								onclick={() => ((choice = o), (failure = ''))}
								class="flex items-center justify-center gap-1.5 rounded-control border py-3 text-base font-medium transition-colors duration-200 {choice === o
									? 'border-accent bg-accent-soft text-accent'
									: 'border-border bg-surface text-text'}"
							>
								{#if mine === o}<Check size={15} />{/if}{VOTE_LABELS[o]}
							</button>
						{/each}
					</div>
					{#if power > 0n}<p class="text-label text-text-faint">Your weight: {formatAmount(power, 2)} staked SCRT. You can change your vote until voting ends.</p>{/if}
					{#if failure}<p class="break-address text-base text-negative" role="alert">{failure}</p>{/if}
					<Button block size="xl" disabled={!choice} onclick={() => ((failure = ''), (reviewing = true))}>{choice ? `Review vote: ${VOTE_LABELS[choice]}` : 'Choose an option'}</Button>
				{/if}
			</section>
		{/if}
	{/if}
</Modal>
