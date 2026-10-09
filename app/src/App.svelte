<script lang="ts">
	import Scanner from './components/Scanner.svelte';
	import InvoiceModal from './components/wallet/InvoiceModal.svelte';
	import PayModal from './components/wallet/PayModal.svelte';
	import ReceiveModal from './components/wallet/ReceiveModal.svelte';
	import SendModal from './components/wallet/SendModal.svelte';
	import SettingsModal from './components/wallet/SettingsModal.svelte';
	import { close, openPayment, takePendingPayLink, ui } from './lib/ui.svelte';
	import { initNative, isNative, takeNativeLink } from './lib/native';
	import { init, wallet } from './lib/wallet.svelte';
	import AccountsModal from './components/wallet/AccountsModal.svelte';
	import AddressBookModal from './components/wallet/AddressBookModal.svelte';
	import BottomNav from './components/wallet/BottomNav.svelte';
	import LightningModal from './components/wallet/LightningModal.svelte';
	import TxDetailModal from './components/wallet/TxDetailModal.svelte';
	import { kv } from './lib/storage';
	import Activity from './screens/Activity.svelte';
	import Home from './screens/Home.svelte';
	import Invoices from './screens/Invoices.svelte';
	import Onboarding from './screens/Onboarding.svelte';
	import Unlock from './screens/Unlock.svelte';
	import Notices from './components/wallet/Notices.svelte';

	// a shared /pay/… link opens straight on the payment once unlocked
	const pending = takePendingPayLink();
	let pendingUsed = false;

	void init();
	void kv.get<boolean>('settings.hideBalance').then((v) => (ui.hideBalance = !!v));
	initNative();

	$effect(() => {
		if (wallet.phase === 'unlocked') {
			if (pending && !pendingUsed) {
				pendingUsed = true;
				openPayment(pending);
			}
			const link = takeNativeLink();
			if (link) openPayment(link);
		} else {
			close();
			ui.scanning = false;
			ui.tab = 'home';
		}
	});

	// Android back button / browser back closes the open dialog
	$effect(() => {
		if (!ui.dialog || isNative) return;
		history.pushState({ dialog: true }, '');
		const pop = () => close();
		addEventListener('popstate', pop);
		return () => removeEventListener('popstate', pop);
	});
</script>

<div class="relative mx-auto flex min-h-[100dvh] w-full max-w-[560px] flex-col px-4 pb-safe pt-safe">
	{#if wallet.phase === 'onboarding'}
		<Onboarding />
	{:else if wallet.phase === 'locked'}
		<Unlock />
	{:else if wallet.phase === 'unlocked'}
		<div class="pb-28">
			<!-- a failing page shows its error instead of taking the whole app (and the tabs) down -->
			{#key ui.tab}
				<svelte:boundary onerror={(e) => console.error(e)}>
					{#if ui.tab === 'home'}<Home />
					{:else if ui.tab === 'activity'}<Activity />
					{:else if ui.tab === 'invoices'}<Invoices />
					{:else}<SettingsModal page />{/if}
					{#snippet failed(error, reset)}
						<div class="card mt-6 flex flex-col gap-3 p-4">
							<p class="text-base font-medium">This screen hit a problem.</p>
							<p class="break-address font-mono text-xs text-text-faint">{error instanceof Error ? error.message : String(error)}</p>
							<button type="button" class="self-start text-base text-accent" onclick={reset}>Try again</button>
						</div>
					{/snippet}
				</svelte:boundary>
			{/key}
		</div>
	{/if}
</div>

{#if wallet.phase === 'unlocked'}<BottomNav /><Notices />{/if}

{#if wallet.phase === 'unlocked'}
	{#if ui.dialog?.name === 'send'}
		<SendModal target={ui.dialog.target} raw={ui.dialog.raw} />
	{:else if ui.dialog?.name === 'pay'}
		{#key ui.dialog.raw}<PayModal target={ui.dialog.target} />{/key}
	{:else if ui.dialog?.name === 'receive'}
		<ReceiveModal />
	{:else if ui.dialog?.name === 'invoice'}
		{#key ui.dialog.id}<InvoiceModal fromReceive={ui.dialog.fromReceive} id={ui.dialog.id} />{/key}
	{:else if ui.dialog?.name === 'settings'}
		<SettingsModal />
	{:else if ui.dialog?.name === 'accounts'}
		<AccountsModal />
	{:else if ui.dialog?.name === 'contacts'}
		<AddressBookModal />
	{:else if ui.dialog?.name === 'tx'}
		{#key ui.dialog.item?.id ?? ui.dialog.hash}<TxDetailModal item={ui.dialog.item} hash={ui.dialog.hash} />{/key}
	{:else if ui.dialog?.name === 'lightning'}
		<LightningModal target={ui.dialog.target} orderId={ui.dialog.orderId} />
	{/if}
	{#if ui.scanning}
		<Scanner
			onresult={(text) => {
				ui.scanning = false;
				openPayment(text);
			}}
			onclose={() => (ui.scanning = false)}
		/>
	{/if}
{/if}
