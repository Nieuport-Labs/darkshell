<script lang="ts">
	import { Check, ChevronRight, History, Loader2, Pencil, Plus, Settings, Trash2 } from '@lucide/svelte';
	import type { FoundAccount } from '../../lib/accountScan';
	import { formatAmount, shortAddress } from '../../lib/format';
	import { close, goTab, open, ui } from '../../lib/ui.svelte';
	import { addAccount, findAccounts, removeAccount, renameAccount, switchAccount, wallet } from '../../lib/wallet.svelte';
	import Button from '../ui/Button.svelte';
	import Modal from '../ui/Modal.svelte';

	let editing = $state<number | null>(null);
	let name = $state('');
	let adding = $state(false);
	let newName = $state('');
	let busy = $state(false);
	/** the account whose removal waits for a second tap */
	let removing = $state<number | null>(null);
	/** accounts of this phrase holding funds that are not in the wallet yet */
	let found = $state<FoundAccount[]>([]);
	let scanning = $state(false);
	let scanFailed = $state(false);

	function edit(index: number, current: string) {
		editing = index;
		removing = null;
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

	async function remove(index: number) {
		if (removing !== index) return (removing = index);
		busy = true;
		try {
			await removeAccount(index);
			removing = null;
		} finally {
			busy = false;
		}
	}

	async function startAdding() {
		adding = true;
		scanning = true;
		scanFailed = false;
		found = [];
		try {
			await findAccounts((a) => (found = [...found, a]));
		} catch {
			scanFailed = true;
		} finally {
			scanning = false;
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

	async function addFound(a: FoundAccount) {
		busy = true;
		try {
			await addAccount(`Account ${a.index + 1}`, a.index);
			close();
		} finally {
			busy = false;
		}
	}
</script>

<Modal title="Accounts" description="All accounts come from your one recovery phrase." onclose={close}>
	<ul class="flex flex-col gap-1">
		{#each wallet.accounts as a (a.index)}
			<li class="flex items-center gap-1 rounded-card {a.index === wallet.active ? 'bg-accent-soft' : ''}">
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
					<button type="button" onclick={() => edit(a.index, a.name)} aria-label="Rename {a.name}" class="state-layer rounded-pill p-2 text-text-muted">
						<Pencil size={16} />
					</button>
					{#if wallet.accounts.length > 1}
						<button
							type="button"
							onclick={() => remove(a.index)}
							disabled={busy}
							aria-label={removing === a.index ? `Confirm removing ${a.name}` : `Remove ${a.name}`}
							class="state-layer mr-1 rounded-pill p-2 {removing === a.index ? 'bg-surface-3 text-negative' : 'text-text-muted'}"
						>
							<Trash2 size={16} />
						</button>
					{/if}
				{/if}
			</li>
			{#if removing === a.index}
				<li class="-mt-0.5 px-3 pb-1 text-label text-text-muted">
					Tap the bin again to remove “{a.name}”. Its funds stay at its address and your recovery phrase still controls it: Add account brings it back.
				</li>
			{/if}
		{/each}
	</ul>

	{#if adding}
		<div class="flex flex-col gap-2">
			<span class="flex items-center gap-2 text-label text-text-muted">
				{#if scanning}<Loader2 size={13} class="animate-spin" /> Looking for accounts with funds…{:else if found.length}Accounts with funds{:else if scanFailed}Could not check other accounts right now.{:else}No other accounts of this phrase hold funds.{/if}
			</span>
			{#each found as f (f.index)}
				<button type="button" disabled={busy} onclick={() => addFound(f)} class="card state-layer flex items-center gap-3 px-3 py-3 text-left">
					<span class="flex size-9 shrink-0 items-center justify-center rounded-pill bg-surface-3 text-label text-text-muted">#{f.index + 1}</span>
					<span class="min-w-0 flex-1">
						<span class="block truncate font-mono text-xs text-text-faint">{shortAddress(f.address, 12, 6)}</span>
						<span class="block text-base tabular-nums">
							{#if f.sscrt > 0n}{formatAmount(f.sscrt)} sSCRT{/if}{#if f.sscrt > 0n && f.native > 0n} · {/if}{#if f.native > 0n}{formatAmount(f.native)} SCRT{/if}
						</span>
					</span>
					<Plus size={18} class="shrink-0 text-accent" />
				</button>
			{/each}
		</div>
		<form class="flex flex-col gap-2" onsubmit={create}>
			<label class="field">
				<span class="text-label text-text-muted">New account</span>
				<input bind:value={newName} maxlength="32" placeholder="Name (optional)" class="field-input" />
			</label>
			<Button type="submit" block size="lg" loading={busy}>Create account</Button>
		</form>
	{:else}
		<Button variant="secondary" block size="lg" onclick={startAdding}>
			{#snippet icon()}<Plus size={17} />{/snippet}
			Add account
		</Button>
	{/if}

	<!-- the app's own menu: Settings (and, in the simple app, Activity) live here, not in a tab -->
	<nav class="-mx-1 flex flex-col border-t border-border pt-2" aria-label="More">
		{#if ui.simple}
			<button type="button" onclick={() => goTab('activity')} class="state-layer flex items-center gap-3 rounded-card px-3 py-3 text-left">
				<History size={18} class="text-text-muted" />
				<span class="flex-1 text-base font-medium">Activity</span>
				<ChevronRight size={16} class="text-text-faint" />
			</button>
		{/if}
		<button type="button" onclick={() => open({ name: 'settings' })} class="state-layer flex items-center gap-3 rounded-card px-3 py-3 text-left">
			<Settings size={18} class="text-text-muted" />
			<span class="flex-1 text-base font-medium">Settings</span>
			<ChevronRight size={16} class="text-text-faint" />
		</button>
	</nav>
</Modal>
