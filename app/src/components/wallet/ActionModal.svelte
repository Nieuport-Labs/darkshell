<script lang="ts">
	import { t, tn } from '../../lib/i18n/index.svelte';
	// The small one-tap transactions — collect staking rewards, make public SCRT
	// private, refill gas credits — get the same recap and swipe as a payment.
	import { Eye, Fuel, ShieldCheck, Sprout } from '@lucide/svelte';
	import { untrack } from 'svelte';
	import { BusyError, type TxOutcome } from '../../lib/chain/tx';
	import { CREDIT_REFILL } from '../../lib/config';
	import { formatAmount } from '../../lib/format';
	import { NoGasError } from '../../lib/gas/feePayer';
	import { fiatValue } from '../../lib/price.svelte';
	import { claimAll, staking, totalRewards } from '../../lib/staking.svelte';
	import { close } from '../../lib/ui.svelte';
	import { prefetchForPayment, refillNow, wallet, wrapPreview, wrapPublic } from '../../lib/wallet.svelte';
	import Modal from '../ui/Modal.svelte';
	import SwipeConfirm from '../ui/SwipeConfirm.svelte';
	import TxStage from './TxStage.svelte';
	import { haptic } from '../../lib/haptics';

	let { action }: { action: 'claim' | 'wrap' | 'refill' } = $props();

	let sending = $state(false);
	let failure = $state('');
	let outcome = $state<TxOutcome | null>(null);
	let wrap = $state<{ amount: bigint; refill: bigint } | null>(null);

	prefetchForPayment();
	if (untrack(() => action) === 'wrap')
		void wrapPreview()
			.then((w) => (wrap = w))
			.catch((e) => (failure = e instanceof Error ? e.message : String(e)));

	// fixed when the dialog opens: rewards keep growing, the recap should not
	const rewards = totalRewards();
	const validators = staking.rewards.length;

	const amount = $derived(action === 'claim' ? rewards : action === 'wrap' ? (wrap ? wrap.amount + wrap.refill : null) : CREDIT_REFILL);
	const title = $derived({ claim: t('Collect rewards'), wrap: t('Make private'), refill: t('Refill gas credits') }[action]);
	const verb = $derived({ claim: t("You're collecting"), wrap: t("You're making private"), refill: t("You're adding") }[action]);
	const unit = $derived(action === 'refill' ? 'sSCRT' : 'SCRT');
	const ready = $derived(action === 'wrap' ? !!wrap && !failure : action === 'claim' ? rewards > 0n : true);

	async function submit() {
		if (!ready || sending) return;
		sending = true;
		failure = '';
		try {
			outcome = action === 'claim' ? await claimAll((p) => (outcome = p)) : action === 'wrap' ? await wrapPublic() : await refillNow();
		} catch (e) {
			haptic.error();
			failure =
				e instanceof NoGasError
					? t('Nothing can pay the network fee: gas credits are empty. See Settings → Gas credits.')
					: e instanceof BusyError || e instanceof Error
						? e.message
						: String(e);
		} finally {
			sending = false;
		}
	}

	const summary = $derived(
		!outcome
			? ''
			: action === 'claim'
				? t('Collected {0} SCRT into your private balance.', { 0: formatAmount(rewards) })
				: action === 'wrap'
					? `${t('Moved into your private balance.')}${outcome.refilled > 0n ? t(' {0} SCRT topped up your gas credits.', { 0: formatAmount(outcome.refilled) }) : ''}`
					: t('Gas credits refilled with {0} sSCRT.', { 0: formatAmount(outcome.refilled) }),
	);
</script>

{#snippet row(label: string, value: string, sub?: string)}
	<div class="flex items-start justify-between gap-4 px-4 py-3.5">
		<dt class="shrink-0 text-text-faint">{label}</dt>
		<dd class="text-right">{value}{#if sub}<span class="block text-label text-text-faint">{sub}</span>{/if}</dd>
	</div>
{/snippet}

<Modal full title={title} onclose={close}>
	{#if outcome || sending}
		<TxStage
			{outcome}
			verbs={{ claim: [t('Collecting'), t('Collected')], wrap: [t('Making it private'), t('Now private')], refill: [t('Refilling'), t('Refilled')] }[action] as [string, string]}
			amount={amount === null ? undefined : formatAmount(amount, 6)}
			{unit}
			sub={amount !== null && fiatValue(amount) ? `≈ ${fiatValue(amount)}` : undefined}
			{summary}
			ondone={close}
		>
			{#snippet icon()}{#if action === 'claim'}<Sprout size={30} />{:else if action === 'wrap'}<ShieldCheck size={30} />{:else}<Fuel size={30} />{/if}{/snippet}
		</TxStage>
	{:else}
		<div class="flex flex-col items-center gap-1 pt-6 text-center">
			<span class="text-label text-text-faint">{verb}</span>
			<div class="flex items-baseline gap-2">
				<span class="text-[2.75rem] font-semibold leading-tight tracking-[-0.03em] tabular-nums">{amount === null ? '…' : `${action === 'wrap' ? '≈ ' : ''}${formatAmount(amount, 6)}`}</span>
				<span class="text-title text-text-muted">{unit}</span>
			</div>
			{#if amount !== null && fiatValue(amount)}<span class="text-base tabular-nums text-text-faint">≈ {fiatValue(amount)}</span>{/if}
		</div>
		<dl class="flex flex-col divide-y divide-border rounded-card border border-border bg-surface-1 text-base">
			{#if action === 'claim'}
				{@render row(t('From'), t('Staking rewards'), tn('{n} validators', validators))}
				{@render row(t('To'), t('Your private balance'), t('claimed and made private in one transaction'))}
			{:else if action === 'wrap'}
				{@render row(t('From'), t('Public SCRT'), t('{0} SCRT on this address', { 0: formatAmount(wallet.native ?? 0n) }))}
				{@render row(t('To'), t('Your private balance'), t('as sSCRT'))}
				{#if wrap && wrap.refill > 0n}{@render row(t('Gas credits'), t('+{0} SCRT', { 0: formatAmount(wrap.refill) }), t('they are low; topped up in the same transaction'))}{/if}
				{@render row(t('Kept'), t('A little SCRT'), t('for the network fee, in case gas credits can’t pay it'))}
			{:else}
				{@render row(t('From'), t('Your private balance'), 'sSCRT')}
				{@render row(t('To'), t('Gas credits'), t('pay the network fee of your next transactions'))}
			{/if}
			{@render row(t('Network fee'), t('Paid from gas credits'))}
		</dl>
		<p class="flex items-start gap-2 px-1 text-label text-text-faint">
			<Eye size={13} class="mt-px shrink-0" />
			{action === 'refill' ? t('The amount moved to gas credits is public on chain.') : t('Collecting and wrapping are public on chain; once it is sSCRT, what you do with it is private.')}
		</p>
		{#if failure}<p class="break-address text-base text-negative animate-[shake_400ms_var(--ease-standard)]" role="alert">{failure}</p>{/if}
		<div class="mt-auto pt-4">
			<SwipeConfirm label={{ claim: t('Swipe to collect'), wrap: t('Swipe to make private'), refill: t('Swipe to refill') }[action]} loading={sending} disabled={!ready && !sending} onconfirm={submit} />
		</div>
	{/if}
</Modal>
