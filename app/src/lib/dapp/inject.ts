// The object a dApp page sees: `window.darkshell`, and `window.keplr` too
// unless another wallet already put one there. It speaks the Keplr API that
// Secret dApps use and forwards every call over a transport (extension
// messaging or the in-app browser's channel). It holds nothing secret and
// decides nothing: DarkShell answers each call.
//
// This file is bundled on its own into the page, so it imports only protocol.ts.

import { DAPP_CHAIN_ID, decode, encode, type DappMethod, type DappResponse } from './protocol';

export interface Transport {
	send(msg: { id: string; method: DappMethod; params: unknown }): Promise<DappResponse>;
	/** account changed or disconnected: the page should ask `getKey` again */
	onKeystoreChange(cb: () => void): void;
}

type Bytes = Uint8Array;

function provider(t: Transport, mode: 'extension' | 'mobile-web') {
	let n = 0;
	const call = async <T>(method: DappMethod, ...params: unknown[]): Promise<T> => {
		const r = await t.send({ id: `${Date.now().toString(36)}.${++n}`, method, params: encode(params) });
		if ('error' in r) throw new Error(r.error);
		return decode(r.result) as T;
	};

	type Account = { address: string; algo: 'secp256k1'; pubkey: Bytes };
	const accounts = async (chainId: string): Promise<Account[]> => {
		const k = await call<{ bech32Address: string; pubKey: Bytes }>('getKey', chainId);
		return [{ address: k.bech32Address, algo: 'secp256k1', pubkey: k.pubKey }];
	};

	const signer = (chainId: string, amino: boolean) => {
		const s: Record<string, unknown> = {
			chainId,
			getAccounts: () => accounts(chainId),
			signAmino: (address: string, doc: unknown) => call('signAmino', chainId, address, doc),
		};
		if (!amino) s.signDirect = (address: string, doc: unknown) => call('signDirect', chainId, address, doc);
		return s;
	};

	const enigma = (chainId: string) => ({
		getPubkey: () => call<Bytes>('enigma.getPubkey', chainId),
		encrypt: (codeHash: string, msg: object) => call<Bytes>('enigma.encrypt', chainId, codeHash, msg),
		decrypt: (ciphertext: Bytes, nonce: Bytes) => call<Bytes>('enigma.decrypt', chainId, ciphertext, nonce),
		getTxEncryptionKey: (nonce: Bytes) => call<Bytes>('enigma.getTxEncryptionKey', chainId, nonce),
	});

	const unsupported = (what: string) => () => Promise.reject(new Error(`DarkShell does not support ${what}.`));

	return Object.freeze({
		version: '0.12.0',
		mode,
		isDarkShell: true,
		defaultOptions: {},
		enable: (chainIds: string | string[]) => call<void>('enable', chainIds),
		disable: () => call<void>('disable'),
		getKey: (chainId: string) => call('getKey', chainId),
		getOfflineSigner: (chainId: string) => signer(chainId, false),
		getOfflineSignerOnlyAmino: (chainId: string) => signer(chainId, true),
		getOfflineSignerAuto: async (chainId: string) => signer(chainId, false),
		signAmino: (chainId: string, address: string, doc: unknown) => call('signAmino', chainId, address, doc),
		signDirect: (chainId: string, address: string, doc: unknown) => call('signDirect', chainId, address, doc),
		signArbitrary: (chainId: string, address: string, data: string | Bytes) => call('signArbitrary', chainId, address, data),
		getEnigmaUtils: (chainId: string) => enigma(chainId),
		getEnigmaPubKey: (chainId: string) => call<Bytes>('enigma.getPubkey', chainId),
		enigmaEncrypt: (chainId: string, codeHash: string, msg: object) => call<Bytes>('enigma.encrypt', chainId, codeHash, msg),
		enigmaDecrypt: (chainId: string, ciphertext: Bytes, nonce: Bytes) => call<Bytes>('enigma.decrypt', chainId, ciphertext, nonce),
		getEnigmaTxEncryptionKey: (chainId: string, nonce: Bytes) => call<Bytes>('enigma.getTxEncryptionKey', chainId, nonce),
		// Secret is built in; any other chain is refused, without asking the user
		experimentalSuggestChain: (info: { chainId?: string }) =>
			info?.chainId === DAPP_CHAIN_ID ? Promise.resolve() : Promise.reject(new Error('DarkShell holds Secret Network only.')),
		suggestToken: unsupported('adding tokens'),
		getSecret20ViewingKey: unsupported('viewing keys (use a permit)'),
		sendTx: unsupported('broadcasting through the wallet'),
		signEthereum: unsupported('Ethereum signing'),
		verifyArbitrary: unsupported('verifying signatures'),
	});
}

export function install(t: Transport, mode: 'extension' | 'mobile-web'): void {
	const w = window as unknown as Record<string, unknown>;
	if (w.darkshell) return;
	const p = provider(t, mode);
	Object.defineProperty(w, 'darkshell', { value: p, writable: false, configurable: false });
	if (!w.keplr) {
		// configurable: a real Keplr installed later may still take it over
		Object.defineProperty(w, 'keplr', { value: p, writable: true, configurable: true });
		w.getOfflineSigner = p.getOfflineSigner;
		w.getOfflineSignerOnlyAmino = p.getOfflineSignerOnlyAmino;
		w.getOfflineSignerAuto = p.getOfflineSignerAuto;
		w.getEnigmaUtils = p.getEnigmaUtils;
	}
	t.onKeystoreChange(() => {
		window.dispatchEvent(new Event('keplr_keystorechange'));
		window.dispatchEvent(new Event('darkshell_keystorechange'));
	});
	window.dispatchEvent(new Event('darkshell#initialized'));
}
