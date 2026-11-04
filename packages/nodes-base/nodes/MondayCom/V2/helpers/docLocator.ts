import type { ILoadOptionsFunctions, INodeListSearchResult, INodeProperties } from 'n8n-workflow';

import { SEARCH_MAX_LIMIT } from './accountSearch';
import { MondayGraphQLClient } from '../transport/MondayGraphQLClient';

/**
 * Every monday doc has two IDs: the internal `id`, and the `object_id` in
 * the doc URL. The From List mode emits the internal ID. Operations that
 * need the other ID resolve it.
 */

/** Matches the object ID in a doc URL, for example https://acme.monday.com/docs/18422738203. */
export const DOC_URL_REGEX = 'https?://[^/]+\\.monday\\.com/docs/([0-9]+)';

export const docResourceLocator: INodeProperties = {
	displayName: 'Doc',
	name: 'docId',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	description: 'The doc to operate on',
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: {
				searchListMethod: 'searchDocs',
				searchable: true,
			},
		},
		{
			displayName: 'By ID',
			name: 'id',
			type: 'string',
			placeholder: 'e.g. 44677893 or 18422738203',
			validation: [
				{
					type: 'regex',
					properties: {
						regex: '[0-9]+',
						errorMessage: 'The doc ID must be a number',
					},
				},
			],
		},
		{
			displayName: 'By URL',
			name: 'url',
			type: 'string',
			placeholder: 'e.g. https://yourorg.monday.com/docs/1234567890',
			validation: [
				{
					type: 'regex',
					properties: {
						regex: DOC_URL_REGEX,
						errorMessage: 'Not a valid monday.com doc URL',
					},
				},
			],
			extractValue: {
				type: 'regex',
				regex: DOC_URL_REGEX,
			},
		},
	],
};

const DOCS_PAGE_SIZE = 50;
/** How many recent docs the name-match fallback scans. The docs query accepts 100 per page. */
const DOCS_FALLBACK_SCAN_SIZE = 100;

interface DocRow {
	id: string;
	name: string;
	url?: string;
	workspace?: { name?: string } | null;
}

/** "Doc (Workspace)", the same label style as the board pickers. */
export function formatDocLabel(doc: {
	name: string;
	workspace?: { name?: string } | null;
}): string {
	return doc.workspace?.name ? `${doc.name} (${doc.workspace.name})` : doc.name;
}

interface DocSearchApiResult {
	id: string;
	live_data?: DocRow | null;
}

/**
 * listSearch method for the doc picker. With no filter, it pages through
 * the most recently used docs. With a filter, it sends one request to
 * search.docs (fuzzy, at most 20 results, no pages). In search results the
 * top-level ID is the object ID and live_data.id is the internal ID, so
 * results without live_data are dropped. search.docs does not index every
 * doc, so an empty result falls back to a name match on recent docs.
 */
export async function searchDocs(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const client = new MondayGraphQLClient(this);
	const toResult = (doc: DocRow) => ({
		name: formatDocLabel(doc),
		value: String(doc.id),
		url: doc.url,
	});
	const fetchRecentDocs = async (limit: number, page: number) => {
		const data = await client.execute(
			`query ($limit: Int!, $page: Int!) {
				docs(limit: $limit, page: $page, order_by: used_at) { id name url workspace { name } }
			}`,
			0,
			{ limit, page },
		);
		return (data.docs ?? []) as DocRow[];
	};

	const query = filter?.trim();
	if (query) {
		const data = await client.execute(
			`query ($q: String!, $limit: Int) {
				search { docs(query: $q, limit: $limit) { results { id live_data { id name url workspace { name } } } } }
			}`,
			0,
			{ q: query, limit: SEARCH_MAX_LIMIT },
		);
		const container = (data.search as { docs?: { results?: DocSearchApiResult[] } } | undefined)
			?.docs;
		const results = (container?.results ?? []).flatMap((result) =>
			result.live_data?.id ? [toResult(result.live_data)] : [],
		);
		if (results.length > 0) return { results };

		const needle = query.toLowerCase();
		const recent = await fetchRecentDocs(DOCS_FALLBACK_SCAN_SIZE, 1);
		return {
			results: recent.filter((doc) => doc.name.toLowerCase().includes(needle)).map(toResult),
		};
	}

	const page = paginationToken ? Number.parseInt(paginationToken, 10) : 1;
	const docs = await fetchRecentDocs(DOCS_PAGE_SIZE, page);
	return {
		results: docs.map(toResult),
		paginationToken: docs.length === DOCS_PAGE_SIZE ? String(page + 1) : undefined,
	};
}
