import { type IDataObject, type IExecuteFunctions, NodeOperationError } from 'n8n-workflow';

import { safeJsonParse } from './json';
import type { MondayGraphQLClient } from '../transport/MondayGraphQLClient';

/**
 * Doc mutations, export_markdown_from_doc and add_content_to_doc_from_markdown
 * accept only the internal doc ID. The doc URL and doc column values carry the
 * object ID. requireDocId resolves both kinds to the internal ID.
 */

/** Fields of every doc read and of the doc that a mutation returns. */
export const DOC_FIELDS = `
	id
	object_id
	name
	doc_kind
	url
	relative_url
	workspace_id
	workspace { id name }
	doc_folder_id
	created_at
	updated_at
	created_by { id name }
	settings
`;

/** Fields of every block read. The content is a JSON string. */
export const DOC_BLOCK_FIELDS = `
	id
	type
	content
	position
	parent_block_id
	doc_id
	created_at
	updated_at
	created_by { id name }
`;

/** The value of the Doc resource locator. */
export interface DocLocatorValue {
	mode?: string;
	value?: string | number;
}

const DOC_URL_ID_PATTERN = /monday\.com\/docs\/([0-9]+)/;

/**
 * Returns the internal doc ID, or null when no doc matches. From List gives
 * the internal ID. By URL gives the object ID. By ID can be either kind, so
 * the internal ID is tried first.
 */
export async function resolveDocId(
	client: MondayGraphQLClient,
	itemIndex: number,
	locator: DocLocatorValue | string | number,
): Promise<string | null> {
	const isLocator = typeof locator === 'object' && locator !== null;
	const raw = String((isLocator ? locator.value : locator) ?? '');
	const mode = isLocator ? locator.mode : undefined;
	const urlMatch = raw.match(DOC_URL_ID_PATTERN);
	const value = urlMatch ? urlMatch[1] : raw.trim();
	if (!value) return null;
	if (mode === 'list') return value;

	if (mode !== 'url' && urlMatch === null) {
		const data = await client.execute('query ($ids: [ID!]) { docs(ids: $ids) { id } }', itemIndex, {
			ids: [value],
		});
		const hit = ((data.docs ?? []) as IDataObject[])[0];
		if (hit?.id) return String(hit.id);
	}

	const data = await client.execute(
		'query ($objectIds: [ID!]) { docs(object_ids: $objectIds) { id } }',
		itemIndex,
		{ objectIds: [value] },
	);
	const hit = ((data.docs ?? []) as IDataObject[])[0];
	return hit?.id ? String(hit.id) : null;
}

/** Reads the Doc parameter and returns the internal doc ID, or throws a not-found error. */
export async function requireDocId(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<string> {
	const locator = this.getNodeParameter('docId', itemIndex) as DocLocatorValue | string;
	const docId = await resolveDocId(client, itemIndex, locator);
	if (docId) return docId;
	const raw = typeof locator === 'object' && locator !== null ? locator.value : locator;
	throw docNotFoundError.call(this, String(raw ?? ''), itemIndex);
}

export function docNotFoundError(this: IExecuteFunctions, docId: string, itemIndex: number) {
	return new NodeOperationError(this.getNode(), `Doc ${docId} was not found`, {
		itemIndex,
		description:
			'Check the doc ID or URL, and that your API token can access the doc. You can use the internal doc ID or the number in the doc URL.',
	});
}

/** Parses a JSON string field. A value that is not valid JSON stays as it is. */
function parseJsonField(value: unknown): unknown {
	if (typeof value !== 'string' || value === '') return value;
	return safeJsonParse(value) ?? value;
}

/** Parses the JSON string fields of a doc row, and of its blocks if present. */
export function formatDocRow(doc: IDataObject): IDataObject {
	const row: IDataObject = { ...doc };
	if ('settings' in doc) row.settings = parseJsonField(doc.settings) as IDataObject;
	if (Array.isArray(doc.blocks)) {
		row.blocks = (doc.blocks as IDataObject[]).map(formatDocBlockRow);
	}
	return row;
}

/** Parses the JSON string content of a block row. */
export function formatDocBlockRow(block: IDataObject): IDataObject {
	return { ...block, content: parseJsonField(block.content) as IDataObject };
}
