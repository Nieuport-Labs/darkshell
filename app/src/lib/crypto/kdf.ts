// Password → 32-byte root via Argon2id. Runs in a Web Worker in the browser so
// the UI keeps animating during the (deliberately slow) derivation.

import { argon2id } from 'hash-wasm';

export interface KdfParams {
	alg: 'argon2id';
	/** iterations */
	t: number;
	/** memory in KiB */
	m: number;
	/** parallelism */
	p: number;
	/** base64 salt, 32 bytes */
	salt: string;
}

/**
 * Production cost. Matches StarShell's production vault (21 iterations,
 * 32 MiB, parallelism 2) — slow enough to make offline guessing expensive,
 * still a couple of seconds on a mid-range phone.
 */
export const DEFAULT_KDF = { t: 21, m: 32 * 1024, p: 2 } as const;

export async function deriveRootDirect(password: Uint8Array, salt: Uint8Array, params: Omit<KdfParams, 'salt' | 'alg'>): Promise<Uint8Array> {
	return argon2id({
		password,
		salt,
		iterations: params.t,
		memorySize: params.m,
		parallelism: params.p,
		hashLength: 32,
		outputType: 'binary',
	});
}

/** Uses a worker when available (browser), the current thread otherwise (tests). */
export async function deriveRoot(password: Uint8Array, salt: Uint8Array, params: Omit<KdfParams, 'salt' | 'alg'>): Promise<Uint8Array> {
	if (typeof Worker === 'undefined' || typeof window === 'undefined') {
		return deriveRootDirect(password, salt, params);
	}
	const worker = new Worker(new URL('./kdf.worker.ts', import.meta.url), { type: 'module' });
	try {
		return await new Promise<Uint8Array>((resolve, reject) => {
			worker.onmessage = (e: MessageEvent<{ ok: true; root: Uint8Array } | { ok: false; error: string }>) =>
				e.data.ok ? resolve(e.data.root) : reject(new Error(e.data.error));
			worker.onerror = (e) => reject(new Error(e.message || 'kdf worker failed'));
			// transfer a copy so the caller can wipe its own password buffer
			const pw = password.slice();
			worker.postMessage({ password: pw, salt, params }, [pw.buffer]);
		});
	} finally {
		worker.terminate();
	}
}
