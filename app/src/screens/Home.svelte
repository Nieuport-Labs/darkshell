<script lang="ts">
	// Layout after Vizor (account header, balance card, Send/Receive, recent
	// activity); components and tokens from Secret_Dashboard.
	import { ArrowDownToLine, ChevronDown, Eye, EyeOff, Loader2, Lock, ScanLine, Send } from '@lucide/svelte';
	import type { TxOutcome } from '../lib/chain/tx';
	import { formatAmount, shortAddress } from '../lib/format';
	import { kv } from '../lib/storage';
	import { price, usdValue } from '../lib/price.svelte';
	import { goTab, open, ui } from '../lib/ui.svelte';
	import { activeName, refresh, totalBalance, wallet, wrapPublic } from '../lib/wallet.svelte';
	import Button from '../components/ui/Button.svelte';
	import ActivityList from '../components/wallet/ActivityList.svelte';
	import GasChip from '../components/wallet/GasChip.svelte';
	import TorIcon from '../components/wallet/TorIcon.svelte';

	let wrapping = $state(false);
	let wrapMsg = $state('');

	function toggleHidden() {
		ui.hideBalance = !ui.hideBalance;
		void kv.set('settings.hideBalance', ui.hideBalance);
	}

	const publicScrt = $derived(wallet.native !== null && wallet.native > 100_000n ? wallet.native : null);
	// sSCRT, public SCRT and pending staking rewards: all of it can be spent (see `pay`)
	const total = $derived(totalBalance());
	const usd = $derived(usdValue(total));
	// 4 decimals: enough to see rewards grow, few enough to read at a glance
	const [int, frac] = $derived((total === null ? '' : formatAmount(total, 4)).split('.'));

	async function makePrivate() {
		wrapping = true;
		wrapMsg = '';
		try {
			const out: TxOutcome = await wrapPublic();
			const topped = out.refilled > 0n ? ` ${formatAmount(out.refilled)} SCRT topped up your gas credits.` : '';
			wrapMsg = (out.status === 'confirmed' ? 'Moved into your private balance.' : 'Sent; waiting for confirmation.') + topped;
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
		<TorIcon onclick={() => goTab('settings')} />
		<GasChip onclick={() => goTab('settings')} />
		<button type="button" onclick={() => (ui.scanning = true)} aria-label="Scan QR code" class="state-layer rounded-pill p-2 text-text-muted">
			<ScanLine size={20} />
		</button>
	</div>
</header>

<!-- the balance is the page: big, with air around it -->
<section class="px-1 pb-8 pt-10">
	<div class="flex items-center justify-between">
		<button type="button" onclick={refresh} class="flex items-center gap-1.5 text-base text-text-muted">
			Balance
			{#if wallet.refreshing || wallet.switching}<Loader2 size={13} class="animate-spin text-text-faint" aria-label="Updating" />{/if}
		</button>
		<button type="button" onclick={toggleHidden} aria-label={ui.hideBalance ? 'Show balance' : 'Hide balance'} class="state-layer -m-1.5 rounded-pill p-1.5 text-text-faint">
			{#if ui.hideBalance}<EyeOff size={18} />{:else}<Eye size={18} />{/if}
		</button>
	</div>

	{#if wallet.balance === null}
		<div class="mt-3 h-[4.5rem] w-52 animate-pulse rounded-control bg-surface"></div>
	{:else}
		<!-- whole sSCRT very large, the decimals smaller beside them -->
		<div class="mt-2 flex items-baseline" aria-label="{ui.hideBalance ? 'Hidden' : formatAmount(total)} sSCRT">
			<span class="{(int?.length ?? 0) > 6 ? 'text-[3.5rem]' : 'text-[4.5rem]'} font-semibold leading-none tracking-[-0.045em] tabular-nums" aria-hidden="true">{ui.hideBalance ? '••••' : int}</span>
			{#if !ui.hideBalance}<span class="text-[2rem] font-semibold leading-none tracking-[-0.03em] tabular-nums text-text-faint" aria-hidden="true">.{frac ?? '00'}</span>{/if}
		</div>
	{/if}

	<!-- unit and USD on the left, staked SCRT on the right: one line -->
	<div class="mt-3 flex min-h-6 items-center justify-between gap-3 text-base tabular-nums text-text-muted">
		<p class="min-w-0 truncate">
			{#if wallet.error}
				<button type="button" onclick={refresh} class="text-negative">Couldn't update. Tap to retry</button>
			{:else if wallet.balance !== null}
				sSCRT{#if price.usd !== null}<span class="text-text-faint">&nbsp;· {ui.hideBalance ? '$••••' : usd}</span>{/if}
			{/if}
		</p>
		{#if wallet.staked > 0n}
			<!-- staked SCRT is locked: not in the balance above, its rewards are -->
			<button type="button" onclick={() => goTab('staking')} class="inline-flex shrink-0 items-center gap-1.5 text-text-faint" aria-label="{ui.hideBalance ? 'Hidden' : formatAmount(wallet.staked, 2)} SCRT staked">
				<Lock size={14} aria-hidden="true" />
				{ui.hideBalance ? '••••' : formatAmount(wallet.staked, 2)} staked
			</button>
		{/if}
	</div>
</section>

<div class="grid grid-cols-2 gap-3">
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

<div class="mt-9">
	<ActivityList limit={5} onseeall={() => goTab('activity')} />
</div>
