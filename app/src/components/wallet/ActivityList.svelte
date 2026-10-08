<script lang="ts">
	import { ArrowDownLeft, ArrowLeftRight, ChevronRight, Fuel, Send, ShieldCheck } from '@lucide/svelte';
	import type { HistoryItem } from '../../lib/chain/sscrt';
	import { SHADESWAP_ROUTER } from '../../lib/chain/shadeSwap';
	import { formatAmount, shortAddress } from '../../lib/format';
	import { ui } from '../../lib/ui.svelte';
	import { usdValue } from '../../lib/price.svelte';
	import { txLog, wallet, type LoggedTx } from '../../lib/wallet.svelte';

	let { limit, title = 'Recent activity', onseeall }: { limit?: number; title?: string; onseeall?: () => void } = $props();

	let logged = $state<LoggedTx[]>([]);
	$effect(() => {
		void wallet.history; // re-read the log whenever history changes
		void txLog().then((l) => (logged = l));
	});

	/** The logged send a redeem belongs to, matched by amount and time. */
	function origin(h: HistoryItem, field: 'refilled' | 'spent'): LoggedTx | undefined {
		if (!h.time) return undefined;
		return logged.find((l) => l[field] === h.amount.toString() && Math.abs(l.time - h.time! * 1000) < 15 * 60_000);
	}

	type Icon = 'in' | 'out' | 'swap' | 'gas' | 'shield';
	function describe(h: HistoryItem): { title: string; detail: string; sign: string; icon: Icon } {
		if (h.kind === 'in') return { title: 'Received', detail: h.counterparty ? `from ${shortAddress(h.counterparty, 6, 4)}` : '', sign: '+', icon: 'in' };
		if (h.kind === 'out' && h.counterparty === SHADESWAP_ROUTER) return { title: 'Swapped', detail: 'to pay an invoice', sign: '−', icon: 'swap' };
		if (h.kind === 'out') return { title: 'Sent', detail: h.counterparty ? `to ${shortAddress(h.counterparty, 6, 4)}` : '', sign: '−', icon: 'out' };
		if (h.kind === 'wrap') return { title: 'Made private', detail: 'from public SCRT', sign: '+', icon: 'shield' };
		if (h.kind === 'unwrap') {
			if (origin(h, 'refilled')) return { title: 'Gas credits', detail: 'refill', sign: '−', icon: 'gas' };
			const o = origin(h, 'spent');
			if (o?.kind === 'ibc') return { title: 'Sent', detail: 'to another chain', sign: '−', icon: 'out' };
			if (o) return { title: 'Sent', detail: 'as public SCRT', sign: '−', icon: 'out' };
			return { title: 'Unwrapped', detail: 'payment or gas', sign: '−', icon: 'out' };
		}
		return { title: 'Other', detail: '', sign: '', icon: 'out' };
	}

	function date(unix?: number): string {
		return unix ? new Date(unix * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
	}

	const shown = $derived(limit ? wallet.history.slice(0, limit) : wallet.history);
</script>

<section class="flex flex-col">
	<div class="flex items-center justify-between pb-2">
		<h2 class="text-title">{title}</h2>
		{#if onseeall && wallet.history.length > (limit ?? 0)}
			<button type="button" onclick={onseeall} class="state-layer -mr-2 flex items-center gap-0.5 rounded-pill px-2 py-1 text-base text-text-muted">
				See all <ChevronRight size={16} />
			</button>
		{/if}
	</div>

	{#if wallet.balance === null && wallet.history.length === 0}
		{#each [0, 1, 2] as i (i)}
			<div class="flex items-center gap-3 py-3">
				<span class="size-10 shrink-0 animate-pulse rounded-pill bg-surface"></span>
				<span class="h-4 flex-1 animate-pulse rounded-control bg-surface"></span>
			</div>
		{/each}
	{:else if shown.length}
		<ul class="flex flex-col">
			{#each shown as h, i (`${h.id}-${i}`)}
				{@const d = describe(h)}
				<li class="flex items-center gap-3 py-3">
					<span class="flex size-10 shrink-0 items-center justify-center rounded-pill bg-surface text-text-muted">
						{#if d.icon === 'in'}<ArrowDownLeft size={17} />{:else if d.icon === 'swap'}<ArrowLeftRight size={17} />{:else if d.icon === 'gas'}<Fuel
								size={17}
							/>{:else if d.icon === 'shield'}<ShieldCheck size={17} />{:else}<Send size={16} />{/if}
					</span>
					<span class="min-w-0 flex-1">
						<span class="block truncate text-base font-medium">{h.memo || d.title}</span>
						<span class="flex items-center gap-1 text-label text-text-faint">
							<ShieldCheck size={12} aria-hidden="true" class="shrink-0 text-accent" />
							<span class="truncate">Private{d.detail ? ` · ${h.memo ? d.title.toLowerCase() + ' ' : ''}${d.detail}` : ''}</span>
						</span>
					</span>
					<span class="flex shrink-0 flex-col items-end">
						<span class="whitespace-nowrap text-base font-medium tabular-nums {d.sign === '+' ? 'text-positive' : 'text-text'}">
							{ui.hideBalance ? '••••' : `${d.sign}${formatAmount(h.amount, 4)}`}
						</span>
						<span class="whitespace-nowrap text-label tabular-nums text-text-faint"
							>{#if !ui.hideBalance && usdValue(h.amount)}{usdValue(h.amount)}&nbsp;·&nbsp;{/if}{date(h.time)}</span
						>
					</span>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="py-3 text-base text-text-muted">Nothing yet. Payments you send and receive appear here.</p>
	{/if}
</section>
