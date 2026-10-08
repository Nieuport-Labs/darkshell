export const te = new TextEncoder();
export const td = new TextDecoder();

export function toB64(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s);
}

export function fromB64(b64: string): Uint8Array {
	const s = atob(b64);
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
	return out;
}

export function randomBytes(n: number): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(n));
}

/** Overwrites a buffer with zeros. JS gives no guarantee about copies, but it shortens the window. */
export function wipe(...buffers: (Uint8Array | undefined | null)[]): void {
	for (const b of buffers) b?.fill(0);
}

/** WebCrypto wants an ArrayBuffer-backed view; this narrows the type without copying. */
export function buf(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
	return bytes as Uint8Array<ArrayBuffer>;
}
