<script lang="ts">
	// "Swap to sSCRT": the account's other tokens, each with what it brings in
	// sSCRT; tick the ones to swap (dust left out unless asked), review, swipe.
	import { Check, Loader2, RefreshCw } from '@lucide/svelte';
	import { fromBaseUnits } from 'secret-pay';
	import { untrack } from 'svelte';
	import { formatAmount } from '../../lib/format';
	import { DUST_USD, loadOthers, others, setIgnoreDust, setMute, swappable, sweep, usdOf, type OtherToken } from '../../lib/pay/dust.svelte';
	import { failureText } from '../../lib/pay/invoicePay';
	import { close } from '../../lib/ui.svelte';
	import Button from '../ui/Button.svelte';
	import Modal from '../ui/Modal.svelte';
	import SwipeConfirm from '../ui/SwipeConfirm.svelte';

	type Phase = 'list' | 'review' | 'sending' | 'done';
	let phase = $state<Phase>('list');
	/** keys unticked by the user (everything shown starts ticked) */
	let off = $state<Set<string>>(new Set());
	let failure = $state('');
	let progress = $state({ done: 0, total: 0 });
	let got = $state(0n);
	let count = $state(0);

	void untrack(() => loadOthers(true));

	const shown = $derived(swappable());
	const noPrice = $derived(others.list.filter((t) => !t.quote));
	const dustLeftOut = $derived(others.ignoreDust ? others.list.filter((t) => t.quote && t.dust).length : 0);
	const chosen = $derived(shown.filter((t) => !off.has(t.key)));
	const total = $derived(chosen.reduce((s, t) => s + (t.quote?.amountOut ?? 0n), 0n));
	const least = $derived(chosen.reduce((s, t) => s + (t.quote?.minOut ?? 0n), 0n));
	const txs = $derived(Math.ceil(chosen.length / 4));

	function tokenAmount(t: OtherToken): string {
		const [int, frac = ''] = fromBaseUnits(t.amount, t.token.decimals).split('.');
		const f = frac.slice(0, 6).replace(/0+$/, '');
		return `${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${f ? `.${f}` : ''}`;
	}

	function usd(sscrt: bigint): string {
		const v = usdOf(sscrt);
		if (v === null) return '';
		return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 });
	}

	function toggle(key: string) {
		const next = new Set(off);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		off = next;
	}

	const allOn = $derived(shown.length > 0 && chosen.length === shown.length);

	async function run() {
		phase = 'sending';
		failure = '';
		const list = chosen;
		got = total;
		count = list.length;
		progress = { done: 0, total: Math.ceil(list.length / 4) };
		try {
			await sweep(list, (done, all) => (progress = { done, total: all }));
			phase = 'done';
		} catch (e) {
			failure = failureText(e);
			phase = 'review';
			void loadOthers(true);
		}
	}
</script>

{#snippet switchRow(on: boolean, label: string, hint: string, onclick: () => void)}
	<button type="button" role="switch" aria-checked={on} {onclick} class="flex w-full items-center gap-3 text-left">
		<span class="flex-1">
			<span class="block text-base">{label}</span>
			<span class="block text-label text-text-faint">{hint}</span>
		</span>
		<span class="relative h-6 w-10 shrink-0 rounded-pill transition-colors duration-200 {on ? 'bg-accent-strong' : 'bg-surface-3'}">
			<span class="absolute top-0.5 size-5 rounded-pill bg-white shadow transition-transform duration-200 [transition-timing-function:var(--ease-emphasised)] {on ? 'translate-x-[1.125rem]' : 'translate-x-0.5'}"></span>
		</span>
	</button>
{/snippet}

<Modal full title="Swap to sSCRT" onclose={phase === 'sending' ? undefined : close} onback={phase === 'review' ? () => (phase = 'list') : undefined}>
	{#if phase === 'done'}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
			<div class="paid-mark is-new !size-20" role="img" aria-label="Done">
				<span class="paid-ring"></span>
				<svg viewBox="0 0 52 52" class="size-full" aria-hidden="true">
					<circle cx="26" cy="26" r="24" class="paid-disc" />
					<path d="M15 27l7 7 15-16" class="paid-check" />
				</svg>
			</div>
			<p class="text-headline">Swapped</p>
			<p class="text-base text-text-muted">{count} {count === 1 ? 'token' : 'tokens'} into ≈ {formatAmount(got, 4)} sSCRT. It shows in your balance in a few seconds.</p>
		</div>
		<Button block size="xl" onclick={close}>Done</Button>
	{:else if phase === 'review' || phase === 'sending'}
		<div class="flex flex-col items-center gap-1 pt-4 text-center">
			<span class="text-base text-text-muted">You get about</span>
			<p class="flex items-baseline gap-2 tabular-nums">
				<span class="text-[3rem] font-semibold leading-none tracking-[-0.035em]">{formatAmount(total, 2)}</span>
				<span class="text-title text-text-muted">sSCRT</span>
			</p>
			{#if usd(total)}<span class="text-base text-text-faint">≈ {usd(total)}</span>{/if}
		</div>
		<dl class="flex flex-col divide-y divide-border rounded-card border border-border bg-surface text-base">
			<div class="flex justify-between gap-4 px-4 py-3">
				<dt class="text-text-muted">Swapping</dt>
				<dd class="min-w-0 text-right">{chosen.map((t) => t.token.symbol).join(', ')}</dd>
			</div>
			<div class="flex justify-between gap-4 px-4 py-3">
				<dt class="text-text-muted">At least</dt>
				<dd class="text-right tabular-nums">{formatAmount(least, 4)} sSCRT</dd>
			</div>
			<div class="flex justify-between gap-4 px-4 py-3">
				<dt class="text-text-muted">Via</dt>
				<dd class="text-right">ShadeSwap · {txs} {txs === 1 ? 'transaction' : 'transactions'}</dd>
			</div>
			<div class="flex justify-between gap-4 px-4 py-3">
				<dt class="text-text-muted">Network fee</dt>
				<dd class="text-right">From gas credits</dd>
			</div>
		</dl>
		<p class="px-1 text-label text-text-faint">If a price moves further than its slippage before the swap runs, that transaction is refused and its tokens stay as they are. Public tokens are made private first, in the same transaction.</p>
		{#if failure}<p class="break-words text-base text-negative" role="alert">{failure}</p>{/if}
		<div class="mt-auto pt-4">
			{#if phase === 'sending'}
				<Button block size="xl" loading disabled>{progress.total > 1 ? `Swapping ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : 'Swapping…'}</Button>
			{:else}
				<SwipeConfirm label="Swipe to swap" disabled={!chosen.length} onconfirm={run} />
			{/if}
		</div>
	{:else}
		<p class="text-base text-text-muted">Tokens on this account other than sSCRT. Swapping turns them into private sSCRT on ShadeSwap.</p>

		<div class="card flex flex-col gap-4 px-4 py-3.5">
			{@render switchRow(others.ignoreDust, 'Leave out dust', `Amounts under $${DUST_USD.toFixed(2)}, not worth a swap`, () => void setIgnoreDust(!others.ignoreDust))}
			{@render switchRow(!others.mute, 'Remind me on Home', 'When there is something worth swapping', () => void setMute(!others.mute))}
		</div>

		{#if others.loading && !others.list.length}
			<p class="flex items-center justify-center gap-2 py-8 text-base text-text-muted"><Loader2 size={16} class="animate-spin" /> Looking for tokens…</p>
		{:else if !shown.length}
			<p class="py-8 text-center text-base text-text-muted">
				{dustLeftOut ? `Only dust here (${dustLeftOut} ${dustLeftOut === 1 ? 'token' : 'tokens'}). Turn off “Leave out dust” to swap it anyway.` : 'No other tokens on this account.'}
			</p>
		{:else}
			<div class="flex flex-col">
				<div class="flex items-center justify-between px-1 pb-1">
					<span class="text-label text-text-muted">{chosen.length} of {shown.length} selected</span>
					<button type="button" onclick={() => (off = allOn ? new Set(shown.map((t) => t.key)) : new Set())} class="text-label font-medium text-accent">{allOn ? 'Select none' : 'Select all'}</button>
				</div>
				<ul class="flex flex-col">
					{#each shown as t (t.key)}
						{@const on = !off.has(t.key)}
						<li>
							<button type="button" role="checkbox" aria-checked={on} onclick={() => toggle(t.key)} class="state-layer -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-card px-2 py-3 text-left">
								<span class="flex size-6 shrink-0 items-center justify-center rounded-[0.4rem] border-2 {on ? 'border-accent-strong bg-accent-strong text-white' : 'border-border-strong'}">
									{#if on}<Check size={15} strokeWidth={3} />{/if}
								</span>
								<span class="min-w-0 flex-1">
									<span class="flex items-center gap-1.5 text-base font-medium">
										{t.token.symbol}
										{#if t.denom}<span class="rounded-pill border border-border px-1.5 text-[0.6875rem] font-normal text-text-faint">public</span>{/if}
										{#if t.dust}<span class="rounded-pill border border-border px-1.5 text-[0.6875rem] font-normal text-text-faint">dust</span>{/if}
									</span>
									<span class="block truncate text-label tabular-nums text-text-faint">{tokenAmount(t)}</span>
								</span>
								<span class="flex shrink-0 flex-col items-end tabular-nums">
									<span class="text-base">≈ {formatAmount(t.quote?.amountOut ?? 0n, 2)} sSCRT</span>
									{#if usd(t.quote?.amountOut ?? 0n)}<span class="text-label text-text-faint">{usd(t.quote?.amountOut ?? 0n)}</span>{/if}
								</span>
							</button>
						</li>
					{/each}
				</ul>
				{#if dustLeftOut}<p class="px-1 pt-1 text-label text-text-faint">{dustLeftOut} small {dustLeftOut === 1 ? 'amount' : 'amounts'} left out as dust.</p>{/if}
			</div>
		{/if}
		{#if noPrice.length}
			<p class="px-1 text-label text-text-faint">No ShadeSwap price right now for {noPrice.map((t) => t.token.symbol).join(', ')}.</p>
		{/if}

		<div class="mt-auto flex flex-col gap-2 pt-4">
			{#if chosen.length}<p class="text-center text-base text-text-muted">You get ≈ <span class="tabular-nums text-text">{formatAmount(total, 2)} sSCRT</span>{#if usd(total)}<span class="text-text-faint"> · {usd(total)}</span>{/if}</p>{/if}
			<Button block size="xl" disabled={!chosen.length || others.loading} onclick={() => (phase = 'review')}>
				{chosen.length ? `Review swap of ${chosen.length} ${chosen.length === 1 ? 'token' : 'tokens'}` : 'Nothing selected'}
			</Button>
			<Button variant="ghost" block onclick={() => loadOthers(true)} disabled={others.loading}>
				{#snippet icon()}{#if others.loading}<Loader2 size={15} class="animate-spin" />{:else}<RefreshCw size={15} />{/if}{/snippet}
				Check again
			</Button>
		</div>
	{/if}
</Modal>
