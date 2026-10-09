// Finds the accounts of a recovery phrase that hold something: sSCRT (read
// with a permit signed locally for each address) or native SCRT. Used when a
// phrase is restored and when adding an account, so accounts made in another
// wallet (Keplr's address index) show up without guessing their number.

import { walletFromMnemonic } from './crypto/account';
import { nativeBalance, readClient } from './chain/client';
import { signPermit, sscrtBalance } from './chain/sscrt';

export interface FoundAccount {
	index: number;
	address: string;
	sscrt: bigint;
	native: bigint;
}

/** empty addresses after the last funded one before the scan stops */
const GAP = 5;
const LIMIT = 40;

/**
 * Funded accounts of `mnemonic`, lowest index first. `skip` lists indexes
 * already in the wallet (still counted for the gap, never returned).
 */
export async function scanAccounts(mnemonic: string, skip: number[] = [], onFound?: (a: FoundAccount) => void): Promise<FoundAccount[]> {
	const client = await readClient();
	const found: FoundAccount[] = [];
	let last = -1;
	for (let start = 0; start < LIMIT && start <= last + GAP; start += GAP) {
		const batch = Array.from({ length: GAP }, (_, k) => start + k).filter((i) => i < LIMIT);
		const results = await Promise.all(
			batch.map(async (index) => {
				const w = walletFromMnemonic(mnemonic, index);
				const [sscrt, native] = await Promise.all([
					signPermit(w).then((p) => sscrtBalance(client, p)).catch(() => 0n),
					nativeBalance(client, w.address).catch(() => 0n),
				]);
				return { index, address: w.address, sscrt, native };
			}),
		);
		for (const r of results) {
			if (r.sscrt === 0n && r.native === 0n) continue;
			last = Math.max(last, r.index);
			if (skip.includes(r.index)) continue;
			found.push(r);
			onFound?.(r);
		}
	}
	return found;
}
