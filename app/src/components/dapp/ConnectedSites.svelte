<script lang="ts">
	// Sites this account is connected to (lib/dapp/permissions.ts), each with Disconnect.
	import { Globe } from '@lucide/svelte';
	import { connections, revoke, siteName, type Connection } from '../../lib/dapp/permissions';
	import { wallet } from '../../lib/wallet.svelte';

	let list = $state<Connection[] | null>(null);

	$effect(() => {
		const address = wallet.address;
		void connections(address).then((l) => {
			if (wallet.address === address) list = l;
		});
	});

	async function drop(origin: string) {
		await revoke(wallet.address, origin);
		list = await connections(wallet.address);
	}

	const when = (t?: number) => (t ? new Date(t).toLocaleDateString() : '');
</script>

{#if list === null}
	<p class="text-label text-text-faint">…</p>
{:else if !list.length}
	<p class="text-label text-text-faint">No site is connected to this account. A site asks first, and you approve it here in DarkShell.</p>
{:else}
	<ul class="flex flex-col divide-y divide-border">
		{#each list as c (c.origin)}
			<li class="flex items-center gap-3 py-2.5">
				<Globe size={16} class="shrink-0 text-text-muted" />
				<span class="min-w-0 flex-1">
					<span class="block break-all text-base">{siteName(c.origin)}</span>
					<span class="block text-label text-text-faint">since {when(c.since)}{c.used ? ` · last used ${when(c.used)}` : ''}</span>
				</span>
				<button type="button" class="state-layer rounded-pill px-3 py-1.5 text-label text-negative" onclick={() => drop(c.origin)}>Disconnect</button>
			</li>
		{/each}
	</ul>
	<p class="mt-1 text-label text-text-faint">A connected site sees this account's address and can ask you to sign. Each signature still needs your approval.</p>
{/if}
