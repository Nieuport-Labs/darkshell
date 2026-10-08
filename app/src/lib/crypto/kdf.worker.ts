import { deriveRootDirect, type KdfParams } from './kdf';

self.onmessage = async (e: MessageEvent<{ password: Uint8Array; salt: Uint8Array; params: Omit<KdfParams, 'salt' | 'alg'> }>) => {
	const { password, salt, params } = e.data;
	try {
		const root = await deriveRootDirect(password, salt, params);
		password.fill(0);
		(self as unknown as Worker).postMessage({ ok: true, root }, [root.buffer]);
	} catch (err) {
		password.fill(0);
		(self as unknown as Worker).postMessage({ ok: false, error: String(err) });
	}
};
