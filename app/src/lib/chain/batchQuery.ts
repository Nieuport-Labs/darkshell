// Many contract queries in one request, through Shade's Batch Query Router.
// Ported from Secret_Dashboard `src/lib/batchQuery.ts` (LCD path only). If the
// router fails, every query is sent on its own instead, so nothing depends on it.

import type { SecretNetworkClient } from 'secretjs';
import { codeHash } from './client';

const ROUTER = 'secret15mkmad8ac036v4nrpcc7nk8wyr578egt077syt';
const BATCH_SIZE = 40;
/** characters of encoded queries per batch; the batch rides in a GET URL */
const URL_BUDGET = 3000;

export interface BatchItem {
	id: string;
	contract: { address: string; codeHash: string };
	query: object;
}

export type BatchResult = { ok: true; value: unknown } | { ok: false; error: string };

const encode = (v: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(v))));
const decode = (v: string) => JSON.parse(decodeURIComponent(escape(atob(v)))) as unknown;

let routerDown = false;

async function one(client: SecretNetworkClient, item: BatchItem): Promise<BatchResult> {
	try {
		const value = await client.query.compute.queryContract({
			contract_address: item.contract.address,
			code_hash: item.contract.codeHash,
			query: item.query,
		});
		return { ok: true, value };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

async function throughRouter(client: SecretNetworkClient, items: BatchItem[]): Promise<Map<string, BatchResult>> {
	const reply = (await client.query.compute.queryContract({
		contract_address: ROUTER,
		code_hash: await codeHash(client, ROUTER),
		query: {
			batch: {
				queries: items.map((i) => ({
					id: encode(i.id),
					contract: { address: i.contract.address, code_hash: i.contract.codeHash },
					query: encode(i.query),
				})),
			},
		},
	})) as { batch?: { responses?: Array<{ id: string; response: { response?: string; system_err?: string } }> } };
	const responses = reply?.batch?.responses;
	if (!Array.isArray(responses)) throw new Error('The batch router did not answer with a batch.');
	const out = new Map<string, BatchResult>();
	for (const r of responses) {
		const id = decode(r.id) as string;
		if (r.response.system_err !== undefined) out.set(id, { ok: false, error: r.response.system_err });
		else if (r.response.response !== undefined) out.set(id, { ok: true, value: decode(r.response.response) });
	}
	return out;
}

async function run(client: SecretNetworkClient, chunk: BatchItem[], results: Map<string, BatchResult>): Promise<void> {
	if (!routerDown && chunk.length > 1) {
		try {
			const answered = await throughRouter(client, chunk);
			for (const i of chunk) results.set(i.id, answered.get(i.id) ?? { ok: false, error: 'No answer in the batch.' });
			return;
		} catch {
			// most likely past the node's query gas limit: halve it
			if (chunk.length >= 8) {
				const half = Math.ceil(chunk.length / 2);
				await Promise.all([run(client, chunk.slice(0, half), results), run(client, chunk.slice(half), results)]);
				return;
			}
			routerDown = true;
		}
	}
	// all at once: each is a separate enclave query on the node, so latency, not
	// throughput, is what costs time here
	const answers = await Promise.all(chunk.map((item) => one(client, item)));
	chunk.forEach((item, k) => results.set(item.id, answers[k]!));
}

function chunksOf(items: BatchItem[]): BatchItem[][] {
	const chunks: BatchItem[][] = [];
	let current: BatchItem[] = [];
	let length = 0;
	for (const item of items) {
		const l = encode(item.query).length + encode(item.id).length + 200;
		if (current.length && (current.length >= BATCH_SIZE || length + l > URL_BUDGET)) {
			chunks.push(current);
			current = [];
			length = 0;
		}
		current.push(item);
		length += l;
	}
	if (current.length) chunks.push(current);
	return chunks;
}

export async function batchQuery(client: SecretNetworkClient, items: BatchItem[]): Promise<Map<string, BatchResult>> {
	const results = new Map<string, BatchResult>();
	const chunks = chunksOf(items);
	// up to 12 requests in flight: quotes wait on the slowest, not the sum
	for (let i = 0; i < chunks.length; i += 12) {
		await Promise.all(chunks.slice(i, i + 12).map((c) => run(client, c, results)));
	}
	return results;
}
