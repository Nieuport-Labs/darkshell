<script lang="ts">
	import { Check, Pencil, Plus } from '@lucide/svelte';
	import { shortAddress } from '../../lib/format';
	import { close } from '../../lib/ui.svelte';
	import { addAccount, renameAccount, switchAccount, wallet } from '../../lib/wallet.svelte';
	import Button from '../ui/Button.svelte';
	import Modal from '../ui/Modal.svelte';

	let editing = $state<number | null>(null);
	let name = $state('');
	let adding = $state(false);
	let newName = $state('');
	let busy = $state(false);

	function edit(index: number, current: string) {
		editing = index;
		name = current;
	}

	async function saveName(e: SubmitEvent) {
		e.preventDefault();
		if (editing !== null) await renameAccount(editing, name);
		editing = null;
	}

	async function pick(index: number) {
		if (busy) return;
		busy = true;
		try {
			await switchAccount(index);
			close();
		} finally {
			busy = false;
		}
	}

	async function create(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		try {
			await addAccount(newName);
			close();
		} finally {
			busy = false;
		}
	}
</script>

<Modal title="Accounts" description="All accounts come from your one recovery phrase." onclose={close}>
	<ul class="flex flex-col gap-1">
		{#each wallet.accounts as a (a.index)}
			<li class="flex items-center gap-2 rounded-card {a.index === wallet.active ? 'bg-accent-soft' : ''}">
				{#if editing === a.index}
					<form class="flex flex-1 items-center gap-2 px-3 py-2" onsubmit={saveName}>
						<!-- svelte-ignore a11y_autofocus -->
						<input bind:value={name} maxlength="32" autofocus class="min-w-0 flex-1 rounded-control border border-border bg-surface px-3 py-2 text-base outline-none" />
						<Button type="submit" size="sm" shape="control">Save</Button>
					</form>
				{:else}
					<button type="button" onclick={() => pick(a.index)} disabled={busy} class="state-layer flex min-w-0 flex-1 items-center gap-3 rounded-card px-3 py-3 text-left">
						<img src="/avatar.webp" alt="" class="size-9 shrink-0 rounded-pill object-cover {a.index === wallet.active ? '' : 'opacity-60 grayscale'}" />
						<span class="min-w-0 flex-1">
							<span class="block truncate text-base font-medium">{a.name}</span>
							<span class="block truncate font-mono text-xs text-text-faint">{shortAddress(a.address, 12, 6)}</span>
						</span>
						{#if a.index === wallet.active}<Check size={18} class="shrink-0 text-accent" />{/if}
					</button>
					<button type="button" onclick={() => edit(a.index, a.name)} aria-label="Rename {a.name}" class="state-layer mr-1 rounded-pill p-2 text-text-muted">
						<Pencil size={16} />
					</button>
				{/if}
			</li>
		{/each}
	</ul>

	{#if adding}
		<form class="flex flex-col gap-2" onsubmit={create}>
			<label class="field">
				<span class="text-label text-text-muted">Name</span>
				<!-- svelte-ignore a11y_autofocus -->
				<input bind:value={newName} maxlength="32" autofocus placeholder="Account {wallet.accounts.length + 1}" class="field-input" />
			</label>
			<Button type="submit" block size="lg" loading={busy}>Create account</Button>
		</form>
	{:else}
		<Button variant="secondary" block size="lg" onclick={() => (adding = true)}>
			{#snippet icon()}<Plus size={17} />{/snippet}
			Add account
		</Button>
	{/if}
</Modal>
