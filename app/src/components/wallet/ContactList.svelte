<script lang="ts">
	// The address book: your own accounts (marked "Mine", always there) and the
	// saved contacts, shared by every account. With `onpick` it chooses a
	// recipient for Send; without it, it is the editor from Settings.
	import { Pencil, Plus, Search, Trash2 } from '@lucide/svelte';
	import { classify } from '../../lib/pay/classify';
	import { shortAddress } from '../../lib/format';
	import { removeContact, saveContact, wallet } from '../../lib/wallet.svelte';
	import Button from '../ui/Button.svelte';

	let { onpick }: { onpick?: (address: string) => void } = $props();

	let query = $state('');
	/** the address being edited, '' for a new contact, null when the form is closed */
	let editing = $state<string | null>(null);
	let name = $state('');
	let address = $state('');
	let removing = $state<string | null>(null);
	let error = $state('');

	const q = $derived(query.trim().toLowerCase());
	const match = (n: string, a: string) => !q || n.toLowerCase().includes(q) || a.toLowerCase().includes(q);
	const mine = $derived(wallet.accounts.filter((a) => match(a.name, a.address)));
	const contacts = $derived(wallet.contacts.filter((c) => match(c.name, c.address)));

	function startEdit(c?: { name: string; address: string }) {
		editing = c?.address ?? '';
		name = c?.name ?? '';
		address = c?.address ?? '';
		removing = null;
		error = '';
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		const a = address.trim();
		const t = classify(a);
		if (!name.trim()) return (error = 'Give the contact a name.');
		if (a.includes('?') || (t.kind !== 'secret' && t.kind !== 'ibc')) return (error = 'Enter a secret1… address (or an address on a connected chain).');
		if (wallet.accounts.some((x) => x.address === a)) return (error = 'That is one of your own accounts — it is already listed.');
		await saveContact({ name, address: a }, editing || undefined);
		editing = null;
	}

	async function remove(a: string) {
		if (removing !== a) return (removing = a);
		await removeContact(a);
		removing = null;
	}
</script>

<label class="flex items-center gap-2 rounded-pill bg-surface px-4 py-2.5">
	<Search size={16} class="shrink-0 text-text-faint" />
	<input bind:value={query} placeholder="Search name or address" aria-label="Search contacts" autocomplete="off" spellcheck="false" class="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-text-faint" />
</label>

{#if mine.length}
	<section class="flex flex-col gap-1">
		<h3 class="px-1 text-label text-text-faint">My accounts</h3>
		{#each mine as a (a.index)}
			{@const self = a.index === wallet.active}
			<button
				type="button"
				disabled={!onpick || self}
				onclick={() => onpick?.(a.address)}
				class="flex items-center gap-3 rounded-card px-3 py-2.5 text-left {onpick && !self ? 'state-layer' : ''} {onpick && self ? 'opacity-50' : ''}"
			>
				<img src="/avatar.webp" alt="" class="size-9 shrink-0 rounded-pill object-cover" />
				<span class="min-w-0 flex-1">
					<span class="flex items-center gap-2">
						<span class="truncate text-base font-medium">{a.name}</span>
						<span class="shrink-0 rounded-pill bg-accent-soft px-2 py-0.5 text-[0.6875rem] font-medium text-accent">{self ? 'This account' : 'Mine'}</span>
					</span>
					<span class="block truncate font-mono text-xs text-text-faint">{shortAddress(a.address, 12, 6)}</span>
				</span>
			</button>
		{/each}
	</section>
{/if}

<section class="flex flex-col gap-1">
	<h3 class="px-1 text-label text-text-faint">Contacts</h3>
	{#each contacts as c (c.address)}
		<div class="flex items-center gap-1 rounded-card">
			<button type="button" disabled={!onpick} onclick={() => onpick?.(c.address)} class="flex min-w-0 flex-1 items-center gap-3 rounded-card px-3 py-2.5 text-left {onpick ? 'state-layer' : ''}">
				<span class="flex size-9 shrink-0 items-center justify-center rounded-pill bg-surface-3 text-base font-medium uppercase text-text-muted">{c.name.slice(0, 1)}</span>
				<span class="min-w-0 flex-1">
					<span class="block truncate text-base font-medium">{c.name}</span>
					<span class="block truncate font-mono text-xs text-text-faint">{shortAddress(c.address, 12, 6)}</span>
				</span>
			</button>
			<button type="button" onclick={() => startEdit(c)} aria-label="Edit {c.name}" class="state-layer rounded-pill p-2 text-text-muted"><Pencil size={16} /></button>
			<button
				type="button"
				onclick={() => remove(c.address)}
				aria-label={removing === c.address ? `Confirm deleting ${c.name}` : `Delete ${c.name}`}
				class="state-layer mr-1 rounded-pill p-2 {removing === c.address ? 'bg-surface-3 text-negative' : 'text-text-muted'}"><Trash2 size={16} /></button
			>
		</div>
		{#if removing === c.address}<p class="-mt-0.5 px-3 text-label text-text-muted">Tap the bin again to delete “{c.name}”.</p>{/if}
	{:else}
		<p class="px-1 text-base text-text-muted">{q ? 'No contact matches.' : 'No contacts yet.'}</p>
	{/each}
</section>

{#if editing !== null}
	<form class="card flex flex-col gap-2 p-3" onsubmit={save}>
		<!-- svelte-ignore a11y_autofocus -->
		<input bind:value={name} maxlength="40" placeholder="Name" aria-label="Contact name" autofocus class="rounded-control border border-border bg-surface px-3 py-2.5 text-base outline-none" />
		<input bind:value={address} placeholder="secret1…" aria-label="Contact address" autocomplete="off" autocapitalize="none" spellcheck="false" class="rounded-control border border-border bg-surface px-3 py-2.5 font-mono text-sm outline-none" />
		{#if error}<p class="text-label text-negative" role="alert">{error}</p>{/if}
		<div class="flex gap-2">
			<Button variant="ghost" shape="control" class="flex-1" onclick={() => (editing = null)}>Cancel</Button>
			<Button type="submit" shape="control" class="flex-1">Save</Button>
		</div>
	</form>
{:else}
	<Button variant="secondary" block size="lg" onclick={() => startEdit()}>
		{#snippet icon()}<Plus size={17} />{/snippet}
		Add contact
	</Button>
{/if}
