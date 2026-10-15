<script lang="ts">
	import { t } from '../../lib/i18n/index.svelte';
	// The screen a transaction runs on, from the swipe to the block: the orb
	// spins while it is signed and sent, slows while the block is awaited, and
	// lands with a tick, ripples and a buzz. Three steps underneath say where
	// it is; once it is in, the details and Done rise in after the orb.
	import { ExternalLink } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import type { TxOutcome } from '../../lib/chain/tx';
	import { explorerTx } from '../../lib/config';
	import { formatAmount } from '../../lib/format';
	import { haptic } from '../../lib/haptics';
	import Button from '../ui/Button.svelte';
	import Orb from '../ui/Orb.svelte';

	let {
		outcome,
		verbs,
		amount,
		unit = '',
		sub,
		line,
		summary,
		busyText,
		icon,
		compact = false,
		ondone,
	}: {
		/** null while it is being signed and sent */
		outcome: TxOutcome | null;
		/** what it is doing, and what it did: [t('Sending'), 'Sent'] */
		verbs: [string, string];
		amount?: string;
		unit?: string;
		/** under the amount (≈ $) */
		sub?: string;
		/** who or what it went to */
		line?: string;
		/** a sentence once it is in */
		summary?: string;
		/** overrides the busy status line (e.g. "Swapping 2 of 3…") */
		busyText?: string;
		icon?: Snippet;
		compact?: boolean;
		ondone?: () => void;
	} = $props();

	const state = $derived(!outcome ? 'busy' : outcome.status === 'pending' ? 'pending' : 'done');
	const status = $derived(state === 'busy' ? (busyText ?? `${verbs[0]}…`) : state === 'pending' ? t('Waiting for the block…') : verbs[1]);

	// the buzz goes with the tick, only when it lands while on screen
	let landed = false;
	$effect(() => {
		if (state !== 'done' || landed) return;
		landed = true;
		const t = setTimeout(() => haptic.success(), 480);
		return () => clearTimeout(t);
	});

	const feeBy = $derived(
		outcome ? { credits: t('paid from your gas credits'), grant: t('paid by a fee grant'), self: t('paid from your public SCRT') }[outcome.plan.source] : '',
	);
</script>

<div class="flex flex-1 flex-col items-center {compact ? 'gap-4 pt-4' : 'gap-6 pt-8'}">
	<div class="pop-in">
		<Orb state={state === 'busy' ? 'busy' : state} size={compact ? '6.5rem' : '9.5rem'} label={status} {icon} />
	</div>

	<div class="flex flex-col items-center gap-1.5 text-center">
		{#key status}
			<p class="rise text-base font-medium {state === 'done' ? 'text-positive' : 'text-text-muted'}" aria-live="polite">{status}</p>
		{/key}
		{#if amount}
			<p class="rise-blur flex items-baseline gap-2 tabular-nums" style="animation-delay: 80ms">
				<span class="{compact ? 'text-[2.5rem]' : 'text-[3rem]'} font-semibold leading-none tracking-[-0.035em]">{amount}</span>
				{#if unit}<span class="text-title text-text-muted">{unit}</span>{/if}
			</p>
		{/if}
		{#if sub}<p class="rise text-base tabular-nums text-text-faint" style="animation-delay: 140ms">{sub}</p>{/if}
		{#if line}<p class="rise text-base text-text-muted" style="animation-delay: 180ms">{line}</p>{/if}
	</div>

	<!-- signed → sent → in a block -->
	<div class="rise w-full max-w-[300px]" style="animation-delay: 220ms" aria-hidden="true">
		<div class="tx-steps">
			<span class="tx-step-dot" data-on={state === 'busy'} data-done={state !== 'busy'}></span>
			<span class="tx-step-bar" data-busy={state === 'busy'} style="--fill: {state === 'busy' ? 0 : 1}"></span>
			<span class="tx-step-dot" data-on={state === 'pending'} data-done={state === 'done'}></span>
			<span class="tx-step-bar" data-busy={state === 'pending'} style="--fill: {state === 'done' ? 1 : 0}"></span>
			<span class="tx-step-dot" data-done={state === 'done'}></span>
		</div>
		<div class="mt-2 flex justify-between text-label text-text-faint">
			<span class={state === 'busy' ? 'text-text' : ''}>{t('Signed')}</span>
			<span class={state === 'pending' ? 'text-text' : ''}>{t('Sent')}</span>
			<span class={state === 'done' ? 'text-positive' : ''}>{t('In a block')}</span>
		</div>
	</div>

	{#if !compact}
		{#if state === 'pending'}
			<p class="rise max-w-[30ch] text-center text-label text-text-faint" style="animation-delay: 300ms">{t('It\'s on its way. A block takes a few seconds —')} <strong class="text-text-muted">{t('don\'t send it again')}</strong>.</p>
		{/if}

		{#if outcome && state === 'done'}
			<div class="stagger flex w-full flex-col gap-3" style="--stagger-delay: 650ms">
				{#if summary}<p class="text-center text-base text-text-muted">{summary}</p>{/if}
				<p class="text-center text-label text-text-faint">
					{t('Network fee {0} SCRT, {1}.', { 0: formatAmount(outcome.plan.fee), 1: feeBy })}{outcome.refilled > 0n ? t(' Gas credits were topped up with {0} in the same transaction.', { 0: formatAmount(outcome.refilled) }) : ''}
				</p>
				<a href={explorerTx(outcome.hash)} target="_blank" rel="noreferrer noopener" class="inline-flex items-center gap-1.5 self-center text-base text-accent underline underline-offset-4">
					{t('View transaction')} <ExternalLink size={14} aria-hidden="true" />
				</a>
			</div>
		{/if}

		{#if ondone && state !== 'busy'}
			<!-- after the details; while waiting for the block, a moment later -->
			<div class="rise mt-auto w-full pt-4" style="animation-delay: {state === 'done' ? 850 : 2500}ms">
				<Button block size="xl" variant={state === 'done' ? 'primary' : 'secondary'} onclick={ondone}>{state === 'done' ? t('Done') : t('Close')}</Button>
			</div>
		{/if}
	{/if}
</div>
