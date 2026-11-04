import { type IDataObject, type IExecuteFunctions, NodeOperationError } from 'n8n-workflow';

import { isPlainJsonObject, safeJsonParse } from './json';
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

/** Reads one doc by its internal ID or its object ID. */
export async function readDoc(
	client: MondayGraphQLClient,
	itemIndex: number,
	id: string,
	kind: 'id' | 'objectId',
): Promise<IDataObject | undefined> {
	const data = await client.execute(
		`query ($ids: [ID!]) { docs(${kind === 'id' ? 'ids' : 'object_ids'}: $ids) { ${DOC_FIELDS} } }`,
		itemIndex,
		{ ids: [id] },
	);
	const doc = ((data.docs ?? []) as IDataObject[])[0];
	return doc ? formatDocRow(doc) : undefined;
}

/**
 * Some doc mutations report a failure in the result ({ success: false, error }),
 * not as a GraphQL error. This throws for that case.
 */
export function assertDocMutationSucceeded(
	this: IExecuteFunctions,
	result: IDataObject,
	action: string,
	itemIndex: number,
): void {
	if (result.success === true) return;
	throw new NodeOperationError(this.getNode(), `monday.com could not ${action}`, {
		itemIndex,
		description: String(result.error ?? 'monday.com did not give a reason.'),
	});
}

/** The DocKind values. monday.com uses private when the kind is not set. */
export const DOC_KIND_OPTIONS = [
	{ name: 'Private', value: 'private' },
	{ name: 'Public', value: 'public' },
	{ name: 'Shareable', value: 'share' },
];

export function assertDocKind(this: IExecuteFunctions, kind: unknown, itemIndex: number): string {
	const value = String(kind);
	if (DOC_KIND_OPTIONS.some((option) => option.value === value)) return value;
	throw new NodeOperationError(this.getNode(), `Kind "${value}" is not supported`, {
		itemIndex,
		description: 'Use private, public or share.',
	});
}

/** The DocBlockContentType values. */
export const DOC_BLOCK_TYPE_OPTIONS = [
	{ name: 'Bulleted List', value: 'bulleted_list' },
	{ name: 'Check List', value: 'check_list' },
	{ name: 'Code', value: 'code' },
	{ name: 'Divider', value: 'divider' },
	{ name: 'Image', value: 'image' },
	{ name: 'Large Title', value: 'large_title' },
	{ name: 'Layout', value: 'layout' },
	{ name: 'Medium Title', value: 'medium_title' },
	{ name: 'Normal Text', value: 'normal_text' },
	{ name: 'Notice Box', value: 'notice_box' },
	{ name: 'Numbered List', value: 'numbered_list' },
	{ name: 'Page Break', value: 'page_break' },
	{ name: 'Quote', value: 'quote' },
	{ name: 'Small Title', value: 'small_title' },
	{ name: 'Table', value: 'table' },
	{ name: 'Video', value: 'video' },
];

const TEXT_BLOCK_TYPES = new Set([
	'bulleted_list',
	'check_list',
	'code',
	'large_title',
	'medium_title',
	'normal_text',
	'numbered_list',
	'quote',
	'small_title',
]);

const EMPTY_CONTENT_BLOCK_TYPES = new Set(['divider', 'page_break']);

/**
 * Builds the block content for the Text mode. Returns null for the types that
 * need structured content (table, layout, image, video and notice box).
 * The content variable must be a JSON string. monday.com rejects an object.
 */
export function buildTextBlockContent(blockType: string, text: string): string | null {
	if (TEXT_BLOCK_TYPES.has(blockType)) return JSON.stringify({ deltaFormat: [{ insert: text }] });
	if (EMPTY_CONTENT_BLOCK_TYPES.has(blockType)) return JSON.stringify({});
	return null;
}

/** Converts the Raw JSON content (a string or an object) to a JSON string, or returns null if it is not a JSON object. */
export function normalizeBlockContentJson(value: unknown): string | null {
	if (isPlainJsonObject(value)) return JSON.stringify(value);
	const text = String(value ?? '').trim();
	if (text === '') return JSON.stringify({});
	const parsed = safeJsonParse(text);
	return isPlainJsonObject(parsed) ? JSON.stringify(parsed) : null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Block IDs are UUIDs. monday.com answers some IDs that are not UUIDs with
 * HTTP 500, or names only the list position, so the node checks them first.
 */
export function assertBlockIds(
	this: IExecuteFunctions,
	blockIds: string[],
	fieldName: string,
	itemIndex: number,
): void {
	const invalid = blockIds.filter((id) => !UUID_PATTERN.test(id));
	if (invalid.length === 0) return;
	throw new NodeOperationError(
		this.getNode(),
		`${fieldName}: ${invalid.map((id) => `"${id}"`).join(', ')} ${invalid.length === 1 ? 'is not a block ID' : 'are not block IDs'}`,
		{
			itemIndex,
			description:
				'A block ID has the form 1983bc9f-70c4-43ff-9d57-c0dcd6431769. Get the IDs with the Get Blocks operation.',
		},
	);
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
