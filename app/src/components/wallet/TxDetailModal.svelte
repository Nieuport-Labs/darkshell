<script lang="ts">
	import { validatorName } from '../../lib/staking.svelte';
	// One activity entry, opened: who, how much, the private memo, when, and
	// the transaction itself (decrypted where this wallet sent it).
	import { AlertCircle, Check, CheckCircle2, ChevronDown, Copy, ExternalLink, Eye, Loader2, ReceiptText, ShieldCheck, ShieldHalf, Zap } from '@lucide/svelte';
	import ActivityIcon from './ActivityIcon.svelte';
	import { fromChain, OVERALL_LABEL, overallOf, stepsOf, type Step } from '../../lib/txSteps';
	import { untrack } from 'svelte';
	import type { HistoryItem } from '../../lib/chain/sscrt';
	import { describe, describeLogged, linkOf } from '../../lib/activity';
	import { SHADESWAP_ROUTER } from '../../lib/chain/shadeSwap';
	import { explorerTx, GAS_VAULT_ADDRESS } from '../../lib/config';
	import { loadLnOrders, lnOrders } from '../../lib/ff/orders.svelte';
	import { formatAmount, shortAddress } from '../../lib/format';
	import { invoices, loadInvoices } from '../../lib/pay/invoices.svelte';
	import { usdValue } from '../../lib/price.svelte';
	import { close, open, ui } from '../../lib/ui.svelte';
	import { chainTx, receivedHash, txLog, wallet, type ChainTxDetail, type LoggedTx } from '../../lib/wallet.svelte';
	import Modal from '../ui/Modal.svelte';

	let { item: i, hash: h }: { item?: HistoryItem; hash?: string } = $props();
	const item = untrack(() => i);

	let link = $state<LoggedTx | undefined>();
	let hash = $state<string | null>(untrack(() => h ?? null));
	let finding = $state(!untrack(() => h));
	let chain = $state<ChainTxDetail | null>(null);
	let chainState = $state<'idle' | 'loading' | 'missing' | 'error'>('idle');
	let rawOpen = $state(false);
	let copied = $state('');

	void Promise.all([txLog(), loadLnOrders(), loadInvoices()]).then(async ([logged]) => {
		link = item ? linkOf(item, logged) : logged.find((l) => l.hash === hash);
		if (!hash && link) hash = link.hash;
		if (!hash && item?.kind === 'in') hash = await receivedHash(item).catch(() => null);
		finding = false;
		if (hash) void loadChain();
	});

	async function loadChain() {
		if (!hash) return;
		chainState = 'loading';
		try {
			chain = await chainTx(hash);
			chainState = chain ? 'idle' : 'missing';
		} catch {
			chainState = 'error';
		}
	}

	const d = $derived(item ? describe(item, link) : link ? describeLogged(link) : null);
	const amount = $derived(item ? item.amount : BigInt(link?.spent ?? link?.amount ?? '0'));
	const status = $derived.by(() => {
		if (chain) return chain.code === 0 ? 'confirmed' : 'failed';
		if (item) return 'confirmed';
		return link?.status ?? 'pending';
	});
	const me = $derived(wallet.accounts.find((a) => a.address === wallet.address)?.name ?? 'You');
	const order = $derived(link?.kind === 'lightning' ? lnOrders.list.find((o) => o.hash === link!.hash) : undefined);
	const memo = $derived(item?.memo || link?.memo);
	const invoice = $derived(memo ? invoices.list.find((x) => x.request.id === memo) : undefined);

	interface Party {
		label: string;
		address?: string;
	}
	function party(address: string | undefined): Party | null {
		if (!address) return null;
		const own = wallet.accounts.find((a) => a.address === address);
		if (address === wallet.address) return { label: `You · ${me}`, address };
		if (own) return { label: own.name, address };
		if (address === SHADESWAP_ROUTER) return { label: 'ShadeSwap', address };
		if (address === GAS_VAULT_ADDRESS) return { label: 'Gas credits', address };
		if (address.startsWith('secretvaloper')) return { label: `Validator · ${validatorName(address)}`, address };
		return { label: '', address };
	}

	const from = $derived.by((): Party | null => {
		if (!item) return party(wallet.address);
		if (item.kind === 'in') return party(item.counterparty) ?? { label: 'Unknown sender' };
		if (item.kind === 'wrap') return { label: 'Your public SCRT', address: wallet.address };
		return party(wallet.address);
	});
	const to = $derived.by((): Party | null => {
		if (link?.kind === 'lightning') return order ? { label: 'Lightning invoice', address: order.invoice } : null;
		if (link?.to) return party(link.to);
		if (!item) return null;
		if (item.kind === 'in' || item.kind === 'wrap') return party(wallet.address);
		if (item.kind === 'unwrap') return { label: link?.refilled ? 'Gas credits' : 'Your public SCRT', address: link?.refilled ? GAS_VAULT_ADDRESS : wallet.address };
		return party(item.counterparty);
	});
	/** what the recipient got, when it was not sSCRT (swapped invoice, IBC, Lightning) */
	const delivered = $derived(link?.amount && link.symbol && link.symbol !== 'sSCRT' && !['stake', 'unstake', 'claim'].includes(link.kind) ? `${formatAmount(BigInt(link.amount))} ${link.symbol}` : null);
	const when = $derived(
		item?.time
			? new Date(item.time * 1000)
			: chain?.time
				? new Date(chain.time)
				: link
					? new Date(link.time)
					: null,
	);

	async function copy(text: string, what: string) {
		await navigator.clipboard.writeText(text).catch(() => {});
		copied = what;
		setTimeout(() => copied === what && (copied = ''), 1500);
	}

	/** what the transaction did, step by step: from the chain when we have it, else as it was sent */
	const steps = $derived.by((): Step[] => {
		if (item?.kind === 'in') return [{ title: 'Private sSCRT transfer', detail: 'received', privacy: 'private' }];
		let list = chain ? stepsOf(fromChain(chain.messages), { validator: validatorName }) : (link?.steps ?? []);
		// no transaction to read: what the private history itself says
		if (!list.length && item) {
			const amt = formatAmount(item.amount);
			list = [
				item.kind === 'unwrap'
					? { title: 'Unwrap sSCRT → public SCRT', detail: `${amt} SCRT, visible on chain`, privacy: 'public' }
					: item.kind === 'wrap'
						? { title: 'Wrap SCRT → sSCRT', detail: `${amt} SCRT, visible on chain`, privacy: 'public' }
						: item.counterparty === SHADESWAP_ROUTER
							? { title: 'Swap on ShadeSwap', detail: `${amt} sSCRT in`, privacy: 'private' }
							: { title: 'Private sSCRT transfer', detail: `${amt} sSCRT`, privacy: 'private' },
			];
		}
		// the last leg of a Lightning payment happens off Secret
		if (link?.kind === 'lightning') return [...list, { title: 'FixedFloat pays the Lightning invoice', detail: 'off Secret Network; FixedFloat sees it', privacy: 'public' }];
		return list;
	});
	const overall = $derived(steps.length ? overallOf(steps) : item ? (item.kind === 'wrap' || item.kind === 'unwrap' ? 'public' : 'private') : null);
	const isVote = $derived(link?.kind === 'vote');

	const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x instanceof Uint8Array ? `0x${[...x].map((b) => b.toString(16).padStart(2, '0')).join('')}` : x), 2);
	const hidden = $derived(ui.hideBalance);
</script>

{#snippet row(label: string, value: string, opts: { mono?: boolean; copyText?: string; sub?: string; subMono?: boolean } = {})}
	<div class="flex items-start justify-between gap-4 px-4 py-3.5">
		<dt class="shrink-0 text-base text-text-faint">{label}</dt>
		<dd class="flex min-w-0 flex-col items-end text-right">
			{#if opts.copyText}
				<button type="button" onclick={() => copy(opts.copyText!, label)} class="flex max-w-full items-center gap-1.5 text-base {opts.mono ? 'font-mono text-[0.875rem]' : ''}">
					<span class="truncate">{value}</span>
					{#if copied === label}<Check size={14} class="shrink-0 text-positive" />{:else}<Copy size={13} class="shrink-0 text-text-faint" />{/if}
				</button>
			{:else}
				<span class="break-words text-base {opts.mono ? 'font-mono text-[0.875rem]' : ''}">{value}</span>
			{/if}
			{#if opts.sub}<span class="text-label text-text-faint {opts.subMono ? 'break-all font-mono' : 'text-balance'}">{opts.sub}</span>{/if}
		</dd>
	</div>
{/snippet}

{#snippet partyRow(label: string, p: Party | null)}
	{#if p}
		{#if p.address}
			{@render row(label, p.label || shortAddress(p.address, 12, 6), { copyText: p.address, mono: !p.label, sub: p.label ? shortAddress(p.address, 12, 6) : undefined, subMono: true })}
		{:else}
			{@render row(label, p.label)}
		{/if}
	{/if}
{/snippet}

<Modal full title={d?.title ?? 'Transaction'} onclose={close}>
	{#if d}
		<div class="flex flex-col items-center gap-2 pt-4 text-center">
			<span class="mb-1"><ActivityIcon icon={d.icon} size={56} /></span>
			{#if isVote}
				<p class="text-title">{link?.memo ?? 'Vote'}</p>
			{:else}
			<div class="flex items-baseline gap-2">
				<span class="text-[2.5rem] font-semibold leading-tight tracking-[-0.03em] tabular-nums {d.sign === '+' ? 'text-positive' : ''} {status === 'failed' ? 'text-text-faint line-through' : ''}"
					>{hidden ? '••••' : `${d.sign}${formatAmount(amount)}`}</span
				>
				<span class="text-title text-text-muted">sSCRT</span>
			</div>
			{#if !hidden && usdValue(amount)}<span class="-mt-1 text-base tabular-nums text-text-faint">≈ {usdValue(amount)}</span>{/if}
			{/if}
			<span
				class="mt-1 inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-label {status === 'confirmed'
					? 'bg-[rgb(52_199_89/0.12)] text-positive'
					: status === 'failed'
						? 'bg-[rgb(255_69_58/0.12)] text-negative'
						: 'bg-accent-soft text-accent'}"
			>
				{#if status === 'confirmed'}<CheckCircle2 size={13} /> Confirmed{:else if status === 'failed'}<AlertCircle size={13} /> Failed{:else}<Loader2 size={13} class="animate-spin" /> Processing{/if}
			</span>
		</div>

		{#if status === 'failed' && (chain?.error || link?.error)}
			<p class="rounded-card bg-surface p-3 text-label text-negative">{chain?.error ?? link?.error}</p>
		{/if}

		<dl class="flex flex-col divide-y divide-border rounded-card border border-border bg-surface-1">
			{@render partyRow('From', from)}
			{@render partyRow('To', to)}
			{#if delivered}{@render row(link?.kind === 'lightning' ? 'Sent' : 'They got', hidden ? '••••' : delivered, { sub: order ? `${Number(order.sats).toLocaleString()} sats over Lightning` : undefined })}{/if}
			{#if memo}{@render row('Memo', memo, { copyText: memo })}{/if}
			{#if when}{@render row('Date', when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }))}{/if}
		</dl>

		{#if order}
			<button type="button" onclick={() => open({ name: 'lightning', orderId: order.id })} class="state-layer flex items-center gap-3 rounded-card border border-border bg-surface-1 px-4 py-3.5 text-left">
				<Zap size={18} class="shrink-0 text-accent" />
				<span class="flex-1 text-base">Lightning payment progress</span>
				<ChevronDown size={16} class="-rotate-90 text-text-faint" />
			</button>
		{/if}
		{#if invoice}
			<button type="button" onclick={() => open({ name: 'invoice', id: invoice.request.id })} class="state-layer flex items-center gap-3 rounded-card border border-border bg-surface-1 px-4 py-3.5 text-left">
				<ReceiptText size={18} class="shrink-0 text-accent" />
				<span class="flex-1 text-base">Invoice{invoice.request.message ? ` · ${invoice.request.message}` : ''}</span>
				<ChevronDown size={16} class="-rotate-90 text-text-faint" />
			</button>
		{/if}

		<dl class="flex flex-col divide-y divide-border rounded-card border border-border bg-surface-1">
			{#if hash}
				{@render row('Transaction', shortAddress(hash, 8, 6), { copyText: hash, mono: true })}
			{:else if finding}
				<div class="flex items-center justify-between px-4 py-3.5 text-base text-text-faint">Transaction <Loader2 size={14} class="animate-spin" /></div>
			{/if}
			{#if item?.height || chain?.height}{@render row('Block', (chain?.height ?? item?.height ?? 0).toLocaleString())}{/if}
			{#if chain?.fee}{@render row('Network fee', chain.fee, { sub: item?.kind === 'in' ? 'paid by the sender' : chain.feePayer === GAS_VAULT_ADDRESS ? 'paid from gas credits' : chain.feePayer ? 'paid by a fee grant' : 'paid from your public SCRT' })}{/if}
			{#if chain}{@render row('Gas', `${chain.gasUsed.toLocaleString()} / ${chain.gasWanted.toLocaleString()}`)}{/if}
		</dl>

		{#if steps.length && overall}
			<section class="flex flex-col gap-2">
				<div class="flex items-center justify-between px-1">
					<h3 class="text-title">Steps</h3>
					<span class="inline-flex items-center gap-1.5 text-label {overall === 'public' ? 'text-text-muted' : 'text-accent'}">
						{#if overall === 'private'}<ShieldCheck size={13} />{:else if overall === 'partial'}<ShieldHalf size={13} />{:else}<Eye size={13} />{/if}
						{OVERALL_LABEL[overall]}
					</span>
				</div>
				<ol class="flex flex-col rounded-card border border-border bg-surface-1">
					{#each steps as st, n (n)}
						<li class="flex items-start gap-3 px-4 py-3.5 {n ? 'border-t border-border' : ''}">
							<span class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-pill bg-surface-3 text-[0.75rem] font-medium text-text-muted">{n + 1}</span>
							<span class="min-w-0 flex-1">
								<span class="block text-base">{st.title}{#if st.upkeep}<span class="text-text-faint"> · upkeep</span>{/if}</span>
								{#if st.detail && !hidden}<span class="block break-words text-label text-text-faint">{st.detail}</span>{/if}
							</span>
							<span class="mt-0.5 inline-flex shrink-0 items-center gap-1 text-label {st.privacy === 'private' ? 'text-accent' : 'text-text-faint'}">
								{#if st.privacy === 'private'}<ShieldCheck size={12} /> Private{:else}<Eye size={12} /> Public{/if}
							</span>
						</li>
					{/each}
				</ol>
				<p class="px-1 text-label text-text-faint">
					Private steps hide the amount, recipient and memo from everyone but the two sides. Public steps — unwrapping, wrapping, staking, sends of public coins and transfers to other chains — are visible to anyone.
				</p>
			</section>
		{/if}

		{#if hash}
			<div class="flex flex-col rounded-card border border-border bg-surface-1">
				<button type="button" onclick={() => (rawOpen = !rawOpen)} aria-expanded={rawOpen} class="state-layer flex items-center justify-between rounded-card px-4 py-3.5 text-base">
					<span>{d.sign === '+' && item?.kind === 'in' ? 'Transaction data' : 'Decrypted transaction'}</span>
					{#if chainState === 'loading'}<Loader2 size={16} class="animate-spin text-text-faint" />{:else}<ChevronDown size={16} class="text-text-faint transition-transform {rawOpen ? 'rotate-180' : ''}" />{/if}
				</button>
				{#if rawOpen}
					<div class="border-t border-border px-4 py-3">
						{#if chain}
							{#if item?.kind === 'in'}<p class="pb-2 text-label text-text-faint">The sender's message is encrypted to them; amount and memo above come from your private history.</p>{/if}
							{#if chain.txMemo}<p class="pb-2 text-label text-text-faint">Public transaction memo: <span class="text-text">{chain.txMemo}</span></p>{/if}
							<pre class="max-h-[50dvh] overflow-auto whitespace-pre-wrap break-all font-mono text-[0.75rem] leading-relaxed text-text-muted">{json(chain.messages)}</pre>
						{:else if chainState === 'missing'}
							<p class="text-label text-text-faint">Not in a block yet.</p>
						{:else if chainState === 'error'}
							<button type="button" onclick={loadChain} class="text-label text-negative">Couldn't load it. Tap to retry.</button>
						{:else}
							<p class="text-label text-text-faint">Loading…</p>
						{/if}
					</div>
				{/if}
			</div>
			<a href={explorerTx(hash)} target="_blank" rel="noreferrer noopener" class="mx-auto inline-flex items-center gap-1.5 pb-2 text-base text-accent">
				View in explorer <ExternalLink size={14} />
			</a>
		{/if}
	{:else}
		<div class="flex items-center justify-center gap-2 py-10 text-base text-text-muted"><Loader2 size={18} class="animate-spin" /> Loading…</div>
	{/if}
</Modal>
