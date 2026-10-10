import { describe, expect, it } from 'vitest';
import { timeline } from '../src/lib/activity';
import type { ChainActivity } from '../src/lib/chain/activity';
import type { HistoryItem } from '../src/lib/chain/sscrt';

const h = (id: string, kind: HistoryItem['kind'], height: number, amount = 5n): HistoryItem => ({ id, kind, amount, height, time: height });
const c = (hash: string, kind: ChainActivity['kind'], height: number, amount = 5n): ChainActivity => ({ hash, kind, height, amount, time: height, failed: false });
const kinds = (e: ReturnType<typeof timeline>) => e.map((x) => (x.type === 'history' ? `h:${x.h.kind}` : x.type === 'chain' ? `c:${x.c.kind}${x.wrapped ? `/${x.wrapped}` : ''}` : `l:${x.l.kind}`));

describe('timeline', () => {
	it('shows a stake from sSCRT once (its unwrap is part of it), even without our own log', () => {
		expect(kinds(timeline([h('1', 'unwrap', 100), h('0', 'in', 90)], [c('A', 'stake', 100)], []))).toEqual(['c:stake/out', 'h:in']);
	});
	it('shows rewards collected into sSCRT once', () => {
		expect(kinds(timeline([h('1', 'wrap', 200)], [c('B', 'claim', 200)], []))).toEqual(['c:claim/in']);
	});
	it('shows a payment that claimed rewards first once, as the payment', () => {
		expect(kinds(timeline([h('2', 'out', 300), h('1', 'wrap', 300)], [c('C', 'claim', 300)], []))).toEqual(['h:out']);
	});
	it('folds a gas refill riding along a payment into the payment', () => {
		expect(kinds(timeline([h('2', 'out', 400), h('1', 'unwrap', 400)], [], []))).toEqual(['h:out']);
	});
	it('shows a public send (unwrap + bank send) and an IBC transfer once each', () => {
		expect(kinds(timeline([h('2', 'unwrap', 600), h('1', 'unwrap', 500)], [c('S', 'out', 600), c('I', 'ibc', 500)], []))).toEqual(['c:out/out', 'c:ibc/out']);
	});
	it('shows a stake that also paid out its rewards into sSCRT once', () => {
		expect(kinds(timeline([h('2', 'wrap', 700), h('1', 'unwrap', 700)], [c('K', 'stake', 700)], []))).toEqual(['c:stake/out']);
	});
	it('keeps a received payment in the same block as our own transaction', () => {
		expect(kinds(timeline([h('2', 'in', 800), h('1', 'unwrap', 800)], [c('K', 'stake', 800)], []))).toEqual(['h:in', 'c:stake/out']);
	});
	it('keeps unrelated entries apart', () => {
		expect(kinds(timeline([h('1', 'unwrap', 100)], [c('V', 'vote', 150)], []))).toEqual(['c:vote', 'h:unwrap']);
	});
	it('adds our logged transactions neither side shows, but not twice', () => {
		const logged = [
			{ hash: 'V', kind: 'vote', time: 160_000, status: 'confirmed' },
			{ hash: 'R', kind: 'refill', time: 170_000, status: 'confirmed' },
		] as never;
		expect(kinds(timeline([], [c('V', 'vote', 160)], logged))).toEqual(['l:refill', 'c:vote']);
	});
});
