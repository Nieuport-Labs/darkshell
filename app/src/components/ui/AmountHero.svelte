<script lang="ts">
	// After Secret_Dashboard src/components/ui/AmountHero.tsx: the amount first
	// and largest, sized to what is typed so the figure stays centred.
	// With `fiat`, the figure can be typed in the chosen currency instead (SCRT
	// price from Osmosis); `amount` is always the token amount.
	import { ArrowUpDown } from '@lucide/svelte';
	import { t } from '../../lib/i18n/index.svelte';
	import { FIATS, fiat as currency, formatFiat, scrtFiat } from '../../lib/price.svelte';

	let {
		amount = $bindable(''),
		symbol,
		readonly = false,
		max,
		fiat = false,
	}: { amount?: string; symbol: string; readonly?: boolean; max?: () => void; fiat?: boolean } = $props();

	let mode = $state<'token' | 'usd'>('token');
	let usdText = $state('');
	/** the token amount we last derived from USD (so outside changes, e.g. Max, are noticed) */
	let fromUsd = '';

	const usd = $derived(scrtFiat());
	const sym = $derived(FIATS.find((f) => f.code === currency.code)!.symbol);
	// € and Kč follow the number, $ goes before it
	const symAfter = $derived(currency.code !== 'USD');
	const canUsd = $derived(fiat && usd !== null && !readonly);
	const num = (s: string) => Number(s.replace(',', '.'));

	function tokenFor(dollars: string): string {
		const n = num(dollars);
		if (!usd || !(n > 0)) return '';
		return (n / usd).toFixed(6).replace(/\.?0+$/, '');
	}

	function usdFor(tokens: string): string {
		const n = num(tokens);
		if (!usd || !(n > 0)) return '';
		return (n * usd).toFixed(2);
	}

	function typeUsd(v: string) {
		usdText = v;
		amount = fromUsd = tokenFor(v);
	}

	// Max (or anything else) set the token amount while typing in USD: follow it
	$effect(() => {
		if (mode === 'usd' && amount !== fromUsd) {
			usdText = usdFor(amount);
			fromUsd = amount;
		}
	});

	function toggle() {
		if (mode === 'token') {
			usdText = usdFor(amount);
			fromUsd = amount;
			mode = 'usd';
		} else mode = 'token';
	}

	const shown = $derived(mode === 'usd' ? usdText : amount);
	const other = $derived.by(() => {
		if (!canUsd) return '';
		if (mode === 'usd') return amount ? `${amount} ${symbol}` : `0 ${symbol}`;
		const v = usdFor(amount);
		return formatFiat(v ? Number(v) : 0);
	});
</script>

<div class="flex flex-col items-center gap-2 py-3">
	<div class="flex max-w-full items-baseline justify-center text-[2.75rem] font-semibold leading-tight tracking-[-0.03em] tabular-nums">
		{#if mode === 'usd' && !symAfter}<span class={usdText ? '' : 'text-text-faint'}>{sym}</span>{/if}
		<input
			inputmode="decimal"
			value={shown}
			oninput={(e) => (mode === 'usd' ? typeUsd(e.currentTarget.value) : (amount = e.currentTarget.value))}
			{readonly}
			placeholder="0"
			aria-label={mode === 'usd' ? t('Amount in {currency}', { currency: currency.code }) : t('Amount of {symbol}', { symbol })}
			style="width: {Math.max(1, shown.length) + (mode === 'usd' ? 0.15 : 0.5)}ch"
			class="min-w-0 max-w-full bg-transparent outline-none placeholder:text-text-faint {mode === 'usd' && !symAfter ? 'text-left' : 'text-center'}"
		/>
		{#if mode === 'usd' && symAfter}<span class="ml-2 text-[0.6em] {usdText ? '' : 'text-text-faint'}">{sym}</span>{/if}
	</div>
	<div class="flex items-center gap-2 text-base text-text-muted">
		<span>{mode === 'usd' ? currency.code : symbol}</span>
		{#if max && !readonly}
			<button type="button" onclick={max} class="state-layer rounded-pill px-2.5 py-1 text-label text-accent">{t('Max')}</button>
		{/if}
	</div>
	{#if canUsd}
		<button
			type="button"
			onclick={toggle}
			aria-label={mode === 'usd' ? t('Enter in {symbol}', { symbol }) : t('Enter in {currency}', { currency: currency.code })}
			class="state-layer mt-1 flex items-center gap-1.5 rounded-pill bg-surface px-3 py-1.5 text-label tabular-nums text-text-muted"
		>
			≈ {other}
			<ArrowUpDown size={13} aria-hidden="true" />
		</button>
	{/if}
</div>
