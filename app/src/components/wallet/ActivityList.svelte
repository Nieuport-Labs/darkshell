<script lang="ts">
	import { AlertCircle, ChevronRight, Eye, Loader2, ShieldCheck, ShieldHalf } from '@lucide/svelte';
	import ActivityIcon from './ActivityIcon.svelte';
	import { OVERALL_LABEL } from '../../lib/txSteps';
	import type { HistoryItem } from '../../lib/chain/sscrt';
	import { chainAmount, describe, describeChain, describeLogged, privacyOf, timeline, unsettled, type Described, type Entry, type Icon } from '../../lib/activity';
	import type { Overall } from '../../lib/txSteps';
	import { loadStaking, staking, validatorName } from '../../lib/staking.svelte';
	import { loadLnOrders, lnOrders } from '../../lib/ff/orders.svelte';
	import { loadXOrders, xOrders } from '../../lib/pay/xorders.svelte';
	import { formatAmount } from '../../lib/format';
	import { open, ui } from '../../lib/ui.svelte';
	import { usdValue } from '../../lib/price.svelte';
	import { txLog, wallet, type LoggedTx } from '../../lib/wallet.svelte';

	let { limit, title = 'Recent activity', onseeall }: { limit?: number; title?: string; onseeall?: () => void } = $props();

	let logged = $state<LoggedTx[]>([]);
	$effect(() => {
		void wallet.history; // re-read the log whenever history or the log changes
		void wallet.logged;
		void txLog().then((l) => (logged = l));
	});
	$effect(() => {
		void wallet.address;
		void loadLnOrders();
		void loadXOrders();
	});
	// validator names for staking entries (once: a failed load is not retried from here)
	let namesAsked = false;
	$effect(() => {
		if (namesAsked || staking.validators.length || !wallet.chainActivity.some((c) => c.counterparty?.startsWith('secretvaloper'))) return;
		namesAsked = true;
		void loadStaking();
	});

	function date(unix?: number): string {
		return unix ? new Date(unix * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
	}

	/** A Lightning payment opens on its own progress page; everything else on the detail. */
	function openItem(h: HistoryItem, link?: LoggedTx) {
		const order = link?.kind === 'lightning' ? lnOrders.list.find((o) => o.hash === link.hash) : undefined;
		const x = link?.kind === 'external' ? xOrders.list.find((o) => o.hash === link.hash) : undefined;
		if (order) open({ name: 'lightning', orderId: order.id });
		else if (x) open({ name: 'external', orderId: x.id });
		else open({ name: 'tx', item: $state.snapshot(h) as HistoryItem });
	}

	function openLogged(l: LoggedTx) {
		const order = l.kind === 'lightning' ? lnOrders.list.find((o) => o.hash === l.hash) : undefined;
		const x = l.kind === 'external' ? xOrders.list.find((o) => o.hash === l.hash) : undefined;
		if (order) open({ name: 'lightning', orderId: order.id });
		else if (x) open({ name: 'external', orderId: x.id });
		else open({ name: 'tx', hash: l.hash });
	}

	const inFlight = $derived(unsettled(logged, wallet.history, wallet.chainActivity));
	const all = $derived(timeline(wallet.history, wallet.chainActivity, logged));
	const shown = $derived(limit ? all.slice(0, Math.max(0, limit - inFlight.length)) : all);

	/** what one entry shows: words, amount, privacy, where a tap goes */
	function view(e: Entry): { d: Described; amount: string; fiat: bigint; pv: Overall; title: string; open: () => void } {
		if (e.type === 'history') {
			const d = describe(e.h, e.link);
			return { d, amount: `${d.sign}${formatAmount(e.h.amount, 4)}`, fiat: e.h.amount, pv: privacyOf(e.h, d.link), title: e.h.memo || d.title, open: () => openItem(e.h, d.link) };
		}
		if (e.type === 'chain') {
			const d = describeChain(e.c, validatorName, e.wrapped);
			const amt = chainAmount(e.c);
			return { d, amount: amt ? `${d.sign}${amt}` : '', fiat: e.c.amount, pv: 'public', title: d.title, open: () => open({ name: 'tx', hash: e.c.hash, chain: $state.snapshot(e.c), wrapped: e.wrapped }) };
		}
		const d = describeLogged(e.l, true);
		const a = BigInt(e.l.kind === 'vote' ? '0' : e.l.spent && e.l.spent !== '0' ? e.l.spent : (e.l.amount ?? '0'));
		return { d, amount: a > 0n ? `${d.sign}${formatAmount(a, 4)}` : '', fiat: a, pv: e.l.privacy ?? 'public', title: d.title, open: () => openLogged(e.l) };
	}
	const key = (e: Entry, i: number) => (e.type === 'history' ? `h-${e.h.id}-${i}` : e.type === 'chain' ? `c-${e.c.hash}` : `l-${e.l.hash}`);
	const timeOf = (e: Entry) => Math.floor(e.time / 1000);
</script>

{#snippet glyph(icon: Icon)}<ActivityIcon {icon} />{/snippet}

<section class="flex flex-col">
	<div class="flex items-center justify-between pb-2">
		<h2 class="text-title">{title}</h2>
		{#if onseeall && (all.length || inFlight.length)}
			<button type="button" onclick={onseeall} class="state-layer -mr-2 flex items-center gap-0.5 rounded-pill px-2 py-1 text-base text-text-muted">
				See all <ChevronRight size={16} />
			</button>
		{/if}
	</div>

	{#if wallet.balance === null && all.length === 0}
		{#each [0, 1, 2] as i (i)}
			<div class="flex items-center gap-3 py-3">
				<span class="size-10 shrink-0 animate-pulse rounded-pill bg-surface"></span>
				<span class="h-4 flex-1 animate-pulse rounded-control bg-surface"></span>
			</div>
		{/each}
	{:else if shown.length || inFlight.length}
		<ul class="flex flex-col">
			{#each inFlight as l (l.hash)}
				{@const d = describeLogged(l)}
				{@const amount = BigInt(l.kind === 'vote' ? '0' : l.spent && l.spent !== '0' ? l.spent : (l.amount ?? '0'))}
				<li>
					<button type="button" onclick={() => openLogged(l)} class="state-layer -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-card px-2 py-3 text-left">
						{@render glyph(d.icon)}
						<span class="min-w-0 flex-1">
							<span class="block truncate text-base font-medium">{l.memo && l.kind === 'send' ? l.memo : d.title}</span>
							<span class="flex items-center gap-1 text-label {l.status === 'failed' ? 'text-negative' : 'text-text-faint'}">
								{#if l.status === 'failed'}<AlertCircle size={12} class="shrink-0" />{:else}<Loader2 size={12} class="shrink-0 animate-spin" />{/if}
								<span class="truncate">{l.status === 'failed' ? 'Failed' : 'Processing'}{d.detail ? ` · ${d.detail}` : ''}</span>
							</span>
						</span>
						<span class="flex shrink-0 flex-col items-end">
							<span class="whitespace-nowrap text-base font-medium tabular-nums {l.status === 'failed' ? 'text-text-faint line-through' : 'text-text'}">
								{l.kind === 'vote' ? '' : ui.hideBalance ? '••••' : `${d.sign}${formatAmount(amount, 4)}`}
							</span>
							<span class="whitespace-nowrap text-label tabular-nums text-text-faint">{date(Math.floor(l.time / 1000))}</span>
						</span>
					</button>
				</li>
			{/each}
			{#each shown as e, i (key(e, i))}
				{@const v = view(e)}
				<li>
					<button type="button" onclick={v.open} class="state-layer -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-card px-2 py-3 text-left">
						{@render glyph(v.d.icon)}
						<span class="min-w-0 flex-1">
							<span class="block truncate text-base font-medium">{v.title}</span>
							<span class="flex items-center gap-1 text-label text-text-faint">
								{#if v.pv === 'private'}<ShieldCheck size={12} aria-hidden="true" class="shrink-0" />{:else if v.pv === 'partial'}<ShieldHalf size={12} aria-hidden="true" class="shrink-0" />{:else}<Eye size={12} aria-hidden="true" class="shrink-0" />{/if}
								<span class="truncate">{OVERALL_LABEL[v.pv]}{v.d.detail ? ` · ${e.type === 'history' && e.h.memo ? v.d.title.toLowerCase() + ' ' : ''}${v.d.detail}` : ''}</span>
							</span>
						</span>
						<span class="flex shrink-0 flex-col items-end">
							<span class="whitespace-nowrap text-base font-medium tabular-nums {v.d.sign === '+' ? 'text-positive' : 'text-text'}">
								{v.amount && ui.hideBalance ? '••••' : v.amount}
							</span>
							<span class="whitespace-nowrap text-label tabular-nums text-text-faint"
								>{#if !ui.hideBalance && v.amount && usdValue(v.fiat)}{usdValue(v.fiat)}&nbsp;·&nbsp;{/if}{date(timeOf(e))}</span
							>
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="py-3 text-base text-text-muted">Nothing yet. Payments you send and receive appear here.</p>
	{/if}
</section>
