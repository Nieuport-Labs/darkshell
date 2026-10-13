<script lang="ts">
	// A site's request, shown in full before anything is signed: connecting,
	// a transaction (step by step, decrypted where it was encrypted to us), a
	// query permit, or a message. Swipe approves; Reject or Back refuses.
	import { AlertTriangle, Eye, Globe, KeyRound, Link2, ShieldCheck, ShieldHalf } from '@lucide/svelte';
	import { answer, dappUi, type Pending } from '../../lib/dapp/host.svelte';
	import { siteName } from '../../lib/dapp/permissions';
	import { isNative } from '../../lib/platform';
	import { shortAddress } from '../../lib/format';
	import { tokenByAddress, privateSymbol } from '../../lib/tokens';
	import { OVERALL_LABEL, overallOf } from '../../lib/txSteps';
	import Button from '../ui/Button.svelte';
	import Modal from '../ui/Modal.svelte';
	import SwipeConfirm from '../ui/SwipeConfirm.svelte';

	let { item }: { item: Pending } = $props();

	let details = $state(false);

	const site = $derived(siteName(item.origin));
	const review = $derived(item.kind === 'sign' ? item.review : null);
	const steps = $derived(review?.steps.filter((s) => !s.upkeep) ?? []);
	const overall = $derived(steps.length ? overallOf(steps) : null);

	const PERMISSION: Record<string, string> = {
		balance: 'balance',
		history: 'transaction history',
		allowance: 'allowances',
		owner: 'everything the owner can read',
		staking: 'staking',
	};
	const tokenName = (a: string) => {
		const t = tokenByAddress(a);
		return t ? privateSymbol(t) : shortAddress(a, 10, 4);
	};

	const title = $derived(item.kind === 'connect' ? 'Connect to site' : (review?.title ?? 'Approve'));
	const confirmLabel = $derived(item.kind === 'connect' ? 'Connect' : review?.permit ? 'Allow' : review?.text !== undefined ? 'Sign' : 'Approve');
	const swipe = $derived(item.kind === 'connect' ? 'Swipe to connect' : review?.permit ? 'Swipe to allow' : review?.text !== undefined ? 'Swipe to sign' : 'Swipe to approve');

	function approve() {
		if (dappUi.busy) return;
		answer(true);
	}

	function reject() {
		answer(false);
	}
</script>

{#snippet row(label: string, value: string, sub?: string)}
	<div class="flex items-start justify-between gap-4 px-4 py-3.5">
		<dt class="shrink-0 text-text-faint">{label}</dt>
		<dd class="min-w-0 break-words text-right">{value}{#if sub}<span class="block text-label text-text-faint">{sub}</span>{/if}</dd>
	</div>
{/snippet}

<Modal full {title} onclose={reject}>
	<div class="flex flex-col items-center gap-2 pt-4 text-center">
		<span class="flex size-14 items-center justify-center rounded-pill bg-surface-2 text-text-muted"><Globe size={26} /></span>
		<span class="break-all text-title">{site}</span>
		{#if !item.origin.startsWith('https://')}<span class="text-label text-negative">Not a secure (https) site</span>{/if}
	</div>

	{#if item.kind === 'connect'}
		<dl class="flex flex-col divide-y divide-border rounded-card border border-border bg-surface-1 text-base">
			{@render row('Account', item.account.name, shortAddress(item.account.address, 12, 6))}
			{@render row('The site sees', 'Your address', 'and can ask you to sign; every request comes here first')}
			{@render row('It never sees', 'Your recovery phrase or PIN')}
		</dl>
		<p class="flex items-start gap-2 px-1 text-label text-text-faint">
			<Link2 size={13} class="mt-px shrink-0" />
			Connect only to sites you trust. You can disconnect it any time in Apps.
		</p>
	{:else if review}
		{#if review.warnings.length}
			<div class="flex flex-col gap-2 rounded-card border border-negative bg-surface-1 px-4 py-3 text-base" role="alert">
				{#each review.warnings as w (w)}
					<p class="flex items-start gap-2"><AlertTriangle size={16} class="mt-0.5 shrink-0 text-negative" />{w}</p>
				{/each}
			</div>
		{/if}

		{#if review.permit}
			<dl class="flex flex-col divide-y divide-border rounded-card border border-border bg-surface-1 text-base">
				{@render row('Lets it read', review.permit.permissions.map((p) => PERMISSION[p] ?? p).join(', ') || 'nothing')}
				{@render row('Of', review.permit.tokens.map(tokenName).join(', ') || '—')}
				{@render row('Permit', review.permit.name || '—', 'can be revoked on chain later')}
				{@render row('Cost', 'Nothing', 'it is not a transaction')}
			</dl>
			<p class="flex items-start gap-2 px-1 text-label text-text-faint">
				<KeyRound size={13} class="mt-px shrink-0" />
				A permit lets the site read your private balance (and history, if listed) for this account. It cannot move anything.
			</p>
		{:else if review.text !== undefined}
			<pre class="max-h-[40vh] overflow-auto whitespace-pre-wrap break-words rounded-card border border-border bg-surface-1 px-4 py-3 text-label">{review.text}</pre>
			<p class="px-1 text-label text-text-faint">Signing a message costs nothing and moves nothing; the site uses it to check that this address is yours.</p>
		{:else}
			{#if steps.length}
				<section class="flex flex-col gap-2">
					<div class="flex items-center justify-between px-1">
						<h3 class="text-title">Steps</h3>
						{#if overall}
							<span class="inline-flex items-center gap-1.5 text-label text-text-muted">
								{#if overall === 'private'}<ShieldCheck size={13} />{:else if overall === 'partial'}<ShieldHalf size={13} />{:else}<Eye size={13} />{/if}
								{OVERALL_LABEL[overall]}
							</span>
						{/if}
					</div>
					<ol class="flex flex-col rounded-card border border-border bg-surface-1">
						{#each steps as st, n (n)}
							<li class="flex items-start gap-3 px-4 py-3.5 {n ? 'border-t border-border' : ''}">
								<span class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-pill bg-surface-3 text-[0.75rem] font-medium text-text-muted">{n + 1}</span>
								<span class="min-w-0 flex-1">
									<span class="block text-base">{st.title}</span>
									{#if st.detail}<span class="block break-words text-label text-text-faint">{st.detail}</span>{/if}
								</span>
								<span class="mt-0.5 inline-flex shrink-0 items-center gap-1 text-label {st.privacy === 'private' ? 'text-text-muted' : 'text-text-faint'}">
									{#if st.privacy === 'private'}<ShieldCheck size={12} /> Private{:else}<Eye size={12} /> Public{/if}
								</span>
							</li>
						{/each}
					</ol>
				</section>
			{/if}
			<dl class="flex flex-col divide-y divide-border rounded-card border border-border bg-surface-1 text-base">
				{@render row('Account', item.account.name, shortAddress(item.account.address, 12, 6))}
				{#if review.fee}{@render row('Network fee', review.fee, review.feePayer ? `paid by ${shortAddress(review.feePayer, 10, 4)}` : 'paid by this account')}{/if}
				{#if review.memo}{@render row('Memo', review.memo, 'public')}{/if}
			</dl>
		{/if}

		{#if review.raw.length}
			<button type="button" class="self-start px-1 text-label text-text-muted underline" onclick={() => (details = !details)}>{details ? 'Hide details' : 'Show details'}</button>
			{#if details}
				<pre class="max-h-[40vh] overflow-auto whitespace-pre-wrap break-all rounded-card border border-border bg-surface-1 px-4 py-3 text-[0.75rem]">{JSON.stringify(review.raw, null, 2)}</pre>
			{/if}
		{/if}
	{/if}

	{#if dappUi.error}<p class="break-address text-base text-negative" role="alert">{dappUi.error}</p>{/if}

	{#if isNative}
		<div class="mt-auto flex flex-col gap-3 pt-4">
			<SwipeConfirm label={swipe} loading={dappUi.busy} onconfirm={approve} />
			<Button variant="secondary" block size="lg" onclick={reject}>Reject</Button>
		</div>
	{:else}
		<!-- with a mouse: plain buttons right under the recap -->
		<div class="flex gap-3 pt-2">
			<Button variant="secondary" block size="lg" class="flex-1" onclick={reject}>Reject</Button>
			<Button block size="lg" class="flex-1" loading={dappUi.busy} onclick={approve}>{confirmLabel}</Button>
		</div>
	{/if}
</Modal>
