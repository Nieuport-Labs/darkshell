// Contract messages and queries are encrypted to the chain's consensus key.
// secretjs would ask the node for it, and a node that answered with its own key
// could read every query (permits included) and every contract message. The
// key is fixed for secret-4, so it is written down instead of asked for.
// (Its own module, importing only secretjs's encryption: the extension's
// background uses it without the rest of secretjs.)

import { EncryptionUtilsImpl } from 'secretjs/dist/encryption';
import { CONSENSUS_IO_PUBKEY } from '../config';
import { fromB64 } from '../crypto/bytes';

export function pinnedEncryption(url: string, seed?: Uint8Array): EncryptionUtilsImpl {
	const utils = new EncryptionUtilsImpl(url, seed);
	(utils as unknown as { consensusIoPubKey: Uint8Array }).consensusIoPubKey = fromB64(CONSENSUS_IO_PUBKEY);
	return utils;
}

/**
 * The same encryption on its own, for a dApp page (its `getEnigmaUtils`). The
 * key is pinned, so no node is ever asked and the URL is unused.
 */
export function encryptionFor(seed: Uint8Array): EncryptionUtilsImpl {
	return pinnedEncryption('https://unused.invalid', seed);
}
