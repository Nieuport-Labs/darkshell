<script lang="ts">
	// Layout after Vizor (account header, balance card, Send/Receive, recent
	// activity); components and tokens from Secret_Dashboard.
	import { ArrowDownToLine, ChevronDown, Eye, EyeOff, Loader2, ScanLine, Send, ShieldCheck } from '@lucide/svelte';
	import type { TxOutcome } from '../lib/chain/tx';
	import { formatAmount, shortAddress } from '../lib/format';
	import { kv } from '../lib/storage';
	import { price, usdValue } from '../lib/price.svelte';
	import { goTab, open, ui } from '../lib/ui.svelte';
	import { activeName, refresh, wallet, wrapPublic } from '../lib/wallet.svelte';
	import Button from '../components/ui/Button.svelte';
	import ActivityList from '../components/wallet/ActivityList.svelte';
	import GasChip from '../components/wallet/GasChip.svelte';

	let wrapping = $state(false);
	let wrapMsg = $state('');

	function toggleHidden() {
		ui.hideBalance = !ui.hideBalance;
		void kv.set('settings.hideBalance', ui.hideBalance);
	}

	const publicScrt = $derived(wallet.native !== null && wallet.native > 100_000n ? wallet.native : null);
	const usd = $derived(usdValue(wallet.balance));
	const [int, frac] = $derived((wallet.balance === null ? '' : formatAmount(wallet.balance, 6)).split('.'));

	async function makePrivate() {
		wrapping = true;
		wrapMsg = '';
		try {
			const out: TxOutcome = await wrapPublic();
			wrapMsg = out.status === 'confirmed' ? 'Moved into your private balance.' : 'Sent; waiting for confirmation.';
		} catch (e) {
			wrapMsg = e instanceof Error ? e.message : String(e);
		} finally {
			wrapping = false;
		}
	}
</script>

<header class="flex items-center justify-between gap-3 pb-5">
	<button type="button" onclick={() => open({ name: 'accounts' })} class="state-layer -ml-1.5 flex min-w-0 items-center gap-3 rounded-pill py-1 pl-1 pr-3 text-left">
		<img src="/avatar.webp" alt="" class="size-10 shrink-0 rounded-pill object-cover" />
		<span class="min-w-0">
			<span class="flex items-center gap-1 text-title">{activeName()}<ChevronDown size={16} class="text-text-muted" /></span>
			<span class="block truncate text-label text-text-faint">{shortAddress(wallet.address, 10, 4)}</span>
		</span>
	</button>
	<div class="flex shrink-0 items-center gap-1">
		<GasChip onclick={() => goTab('settings')} />
		<button type="button" onclick={() => (ui.scanning = true)} aria-label="Scan QR code" class="state-layer rounded-pill p-2 text-text-muted">
			<ScanLine size={20} />
		</button>
	</div>
</header>

<section class="rounded-[20px] border border-border bg-surface-1 px-5 pb-5 pt-4">
	<div class="flex items-center justify-between">
		<button type="button" onclick={refresh} class="flex items-center gap-1.5 text-label text-text-muted">
			<ShieldCheck size={14} class="text-accent" aria-hidden="true" />
			Private balance
			{#if wallet.refreshing || wallet.switching}<Loader2 size={12} class="animate-spin text-text-faint" aria-label="Updating" />{/if}
		</button>
		<button type="button" onclick={toggleHidden} aria-label={ui.hideBalance ? 'Show balance' : 'Hide balance'} class="state-layer -m-1.5 rounded-pill p-1.5 text-text-faint">
			{#if ui.hideBalance}<EyeOff size={17} />{:else}<Eye size={17} />{/if}
		</button>
	</div>

	{#if wallet.balance === null}
		<div class="mt-4 h-[3.25rem] w-48 animate-pulse rounded-control bg-surface"></div>
	{:else}
		<!-- whole sSCRT large; decimals above and the unit below, both small, on the same line -->
		<div class="mt-3 flex items-stretch gap-1.5" aria-label="{ui.hideBalance ? 'Hidden' : formatAmount(wallet.balance)} sSCRT">
			<span class="text-[3.25rem] font-semibold leading-[0.9] tracking-[-0.04em] tabular-nums" aria-hidden="true">{ui.hideBalance ? '••••' : int}</span>
			<span class="flex flex-col justify-between pb-[0.2rem] pt-[0.1rem] text-[0.9375rem] font-semibold leading-none tracking-[-0.01em]" aria-hidden="true">
				<span class="tabular-nums text-text-muted">{ui.hideBalance ? '' : `.${frac ?? '00'}`}</span>
				<span class="text-text-faint">sSCRT</span>
			</span>
		</div>
	{/if}

	<p class="mt-3 min-h-5 text-base tabular-nums text-text-muted">
		{#if wallet.error}
			<button type="button" onclick={refresh} class="text-negative">Couldn't update. Tap to retry</button>
		{:else if wallet.balance !== null && price.usd !== null}
			{ui.hideBalance ? '$••••' : usd}
		{/if}
	</p>
</section>

<div class="mt-3 grid grid-cols-2 gap-3">
	<Button size="lg" class="w-full !py-3.5" onclick={() => open({ name: 'send' })}>
		{#snippet icon()}<Send size={17} />{/snippet}
		Send
	</Button>
	<Button variant="secondary" size="lg" class="w-full !py-3.5" onclick={() => open({ name: 'receive' })}>
		{#snippet icon()}<ArrowDownToLine size={17} />{/snippet}
		Receive
	</Button>
</div>

{#if publicScrt}
	<div class="mt-3 flex items-center justify-between gap-3 rounded-card border border-border bg-surface-1 px-4 py-2.5">
		<span class="text-base text-text-muted">Public SCRT <span class="tabular-nums text-text">{formatAmount(publicScrt)}</span></span>
		<Button variant="text" size="sm" loading={wrapping} onclick={makePrivate}>Make private</Button>
	</div>
	{#if wrapMsg}<p class="mt-1 px-1 text-label text-text-faint">{wrapMsg}</p>{/if}
{/if}

<div class="mt-7">
	<ActivityList limit={5} onseeall={() => goTab('activity')} />
</div>
