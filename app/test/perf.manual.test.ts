// Manual timing of the quote path against mainnet (not part of `npm test`):
//   npx vitest run test/perf.manual.test.ts
import 'fake-indexeddb/auto';
import { describe, it } from 'vitest';
import { readClient } from '../src/lib/chain/client';
import { findRoutes, isSimulated, listPairs, pairsOf, reservesFor } from '../src/lib/chain/shadeSwap';
import { quoteInto } from '../src/lib/pay/quote';

const SSCRT = 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek';
const ATOM = 'secret19e75l25r6sa6nhdf4lggjmgpw0vmpfvsw5cnpe';
const SILK = 'secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd';

const t = () => performance.now();

describe.skipIf(!process.env.PERF)('quote timing', () => {
	it('measures', { timeout: 300_000 }, async () => {
		let s = t();
		const client = await readClient();
		console.log('client', Math.round(t() - s), 'ms');
		s = t();
		const pairs = await listPairs(client);
		console.log('listPairs (cold)', Math.round(t() - s), 'ms', pairs.length, 'pairs');
		for (const [name, token, amount] of [
			['ATOM', ATOM, 1_000_000n],
			['SILK', SILK, 1_000_000n],
		] as const) {
			const routes = findRoutes(pairs, SSCRT, token);
			console.log(name, 'routes', routes.length, 'stable', routes.filter(isSimulated).length);
			s = t();
			await reservesFor(client, pairsOf(routes));
			console.log(name, 'reserves', Math.round(t() - s), 'ms');
			s = t();
			const q = await quoteInto(client, SSCRT, token, amount);
			console.log(name, 'quoteInto', Math.round(t() - s), 'ms', q?.amountIn, q?.route.length, 'hops', q && isSimulated(q.route) ? 'stable' : 'cp');
		}
	});
});
