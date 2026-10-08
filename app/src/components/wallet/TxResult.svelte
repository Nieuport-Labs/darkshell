<script lang="ts">
	import { CheckCircle2, ExternalLink, Loader2 } from '@lucide/svelte';
	import type { TxOutcome } from '../../lib/chain/tx';
	import { explorerTx } from '../../lib/config';
	import { formatAmount } from '../../lib/format';
	import Button from '../ui/Button.svelte';

	let { outcome, summary, ondone }: { outcome: TxOutcome; summary: string; ondone: () => void } = $props();

	const feeBy = $derived(
		{ credits: 'paid from your gas credits', grant: 'paid by a fee grant', self: 'paid from your public SCRT' }[outcome.plan.source],
	);
</script>

<div class="flex flex-1 flex-col gap-4">
	<div class="flex items-start gap-3">
		{#if outcome.status === 'confirmed'}
			<CheckCircle2 size={18} aria-hidden="true" class="mt-0.5 shrink-0 text-positive" />
			<p class="text-base">{summary}</p>
		{:else}
			<Loader2 size={18} aria-hidden="true" class="mt-0.5 shrink-0 animate-spin text-accent" />
			<p class="text-base">
				Sent. Confirming in the next block (a few seconds) — <strong>don't send it again</strong>.
			</p>
		{/if}
	</div>
	<p class="text-label text-text-faint">
		Network fee {formatAmount(outcome.plan.fee)} SCRT, {feeBy}.{outcome.refilled > 0n
			? ` Gas credits were refilled with ${formatAmount(outcome.refilled)} sSCRT in the same transaction.`
			: ''}
	</p>
	<a href={explorerTx(outcome.hash)} target="_blank" rel="noreferrer noopener" class="inline-flex items-center gap-1.5 self-start text-base text-accent underline underline-offset-4">
		View transaction <ExternalLink size={14} aria-hidden="true" />
	</a>
	<div class="mt-auto pt-4"><Button block size="xl" onclick={ondone}>Done</Button></div>
</div>
