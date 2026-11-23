import type { IDataObject, INodePropertyOptions } from 'n8n-workflow';

import type { MondayGraphQLClient } from '../transport/MondayGraphQLClient';

/**
 * The objects in the left pane of a workspace: boards, docs, folders and
 * dashboards. API facts (API 2026-10) that shape this module:
 * - No API returns the left-pane order, so Get Many returns the folder
 *   structure, not the sibling order.
 * - No dated API version lists dashboards, but update_overview_hierarchy
 *   can move them.
 * - The boards query returns boards, docs ("document"), workflows and
 *   other custom objects ("custom_object"), and subitem boards. Subitem
 *   boards never show in the left pane, so they are dropped.
 * - update_board_hierarchy moves boards and docs. A doc needs its object
 *   ID (the number in the doc URL). Its internal ID fails.
 * - A position next to a root-level object takes the object out of its
 *   folder. A position next to an object in a folder does not put it in
 *   the folder: folder_id must also be sent.
 * - A wrong position reference can fail with a generic USER_UNAUTHORIZED.
 */

/** DynamicPosition.object_type values. */
export const POSITION_REFERENCE_TYPE_OPTIONS: INodePropertyOptions[] = [
	{ name: 'Board or Doc', value: 'Board' },
	{ name: 'Dashboard (Overview)', value: 'Overview' },
	{ name: 'Folder', value: 'Folder' },
];

export interface HierarchyPosition {
	/** The ID of the reference object: a board or doc object ID, a folder ID, or a dashboard ID. */
	objectId: string;
	/** Board, Folder or Overview. */
	objectType: string;
	isAfter: boolean;
}

export interface HierarchyMove {
	folderId?: string;
	workspaceId?: string;
	position?: HierarchyPosition;
}

export function toDynamicPosition(position: HierarchyPosition): IDataObject {
	return {
		object_id: position.objectId,
		object_type: position.objectType,
		is_after: position.isAfter,
	};
}

/**
 * Builds the attributes shared by update_board_hierarchy and
 * update_overview_hierarchy. Unset arguments are omitted.
 */
export function buildHierarchyAttributes(move: HierarchyMove): IDataObject {
	const attributes: IDataObject = {};
	if (move.folderId) attributes.folder_id = move.folderId;
	if (move.workspaceId) attributes.workspace_id = move.workspaceId;
	if (move.position) attributes.position = toDynamicPosition(move.position);
	return attributes;
}

/** One output row of Get Many Objects, and one node of the tree output. */
export interface WorkspaceObjectRow extends IDataObject {
	/** board, doc, customObject or folder. */
	objectType: string;
	id: string;
	name: string;
	/** The ID of the folder that holds the object. Null means the workspace root. */
	folderId: string | null;
	workspaceId: string | null;
	url?: string;
	/** Tree output only: the folder contents, folders first. */
	children?: WorkspaceObjectRow[];
}

export interface LeftPaneBoardRow {
	id: string;
	name: string;
	type?: string;
	board_folder_id?: string | null;
	url?: string;
	workspace?: { id?: string | null } | null;
}

export interface LeftPaneFolderRow {
	id: string;
	name: string;
	parent?: { id?: string | null } | null;
	workspace?: { id?: string | null } | null;
}

const BOARD_TYPE_TO_OBJECT_TYPE: Record<string, string> = {
	board: 'board',
	document: 'doc',
	custom_object: 'customObject',
};

/** Maps a boards-query row to an output row. Returns null for subitem boards. */
export function mapLeftPaneBoardRow(row: LeftPaneBoardRow): WorkspaceObjectRow | null {
	const objectType = BOARD_TYPE_TO_OBJECT_TYPE[row.type ?? 'board'];
	if (!objectType) return null;
	const mapped: WorkspaceObjectRow = {
		objectType,
		id: String(row.id),
		name: row.name,
		folderId: row.board_folder_id ? String(row.board_folder_id) : null,
		workspaceId: row.workspace?.id ? String(row.workspace.id) : null,
	};
	if (row.url) mapped.url = row.url;
	return mapped;
}

export function mapLeftPaneFolderRow(row: LeftPaneFolderRow): WorkspaceObjectRow {
	return {
		objectType: 'folder',
		id: String(row.id),
		name: row.name,
		folderId: row.parent?.id ? String(row.parent.id) : null,
		workspaceId: row.workspace?.id ? String(row.workspace.id) : null,
	};
}

const byName = (a: WorkspaceObjectRow, b: WorkspaceObjectRow) => a.name.localeCompare(b.name);

/**
 * Builds the flat output: folders first, then the other objects, each
 * sorted by name. An empty type list includes every type.
 */
export function buildWorkspaceObjectRows(
	folderRows: WorkspaceObjectRow[],
	boardRows: WorkspaceObjectRow[],
	includeTypes: string[],
): WorkspaceObjectRow[] {
	const include = (row: WorkspaceObjectRow) =>
		includeTypes.length === 0 || includeTypes.includes(row.objectType);
	return [...folderRows.filter(include).sort(byName), ...boardRows.filter(include).sort(byName)];
}

/**
 * Builds the tree output: root-level rows, with folder contents in
 * `children`. An object whose folder is not in the rows goes to the root,
 * so it does not disappear.
 */
export function buildWorkspaceObjectTree(
	folderRows: WorkspaceObjectRow[],
	objectRows: WorkspaceObjectRow[],
): WorkspaceObjectRow[] {
	const foldersById = new Map<string, WorkspaceObjectRow & { children: WorkspaceObjectRow[] }>();
	for (const folder of folderRows) {
		foldersById.set(folder.id, { ...folder, children: [] });
	}

	const roots: WorkspaceObjectRow[] = [];
	const attach = (row: WorkspaceObjectRow) => {
		const parent = row.folderId ? foldersById.get(row.folderId) : undefined;
		if (parent) {
			parent.children.push(row);
		} else {
			roots.push(row);
		}
	};
	for (const folder of foldersById.values()) attach(folder);
	for (const row of objectRows) attach(row);

	const sortChildren = (nodes: WorkspaceObjectRow[]): WorkspaceObjectRow[] => {
		const folders = nodes.filter((node) => node.objectType === 'folder').sort(byName);
		const objects = nodes.filter((node) => node.objectType !== 'folder').sort(byName);
		for (const folder of folders) {
			folder.children = sortChildren(folder.children ?? []);
		}
		return [...folders, ...objects];
	};
	return sortChildren(roots);
}

interface LocatorValue {
	mode?: string;
	value?: string | number;
}

/**
 * Resolves the Doc locator value to the doc object ID, the only doc ID that
 * update_board_hierarchy accepts. A URL already holds the object ID. Other
 * values are tried as an internal ID first, then as an object ID.
 * Returns null when no doc matches.
 */
export async function resolveDocObjectId(
	client: MondayGraphQLClient,
	itemIndex: number,
	locator: LocatorValue | string | number,
): Promise<string | null> {
	const isLocator = typeof locator === 'object' && locator !== null;
	const raw = isLocator ? String(locator.value ?? '') : String(locator ?? '');
	const urlMatch = raw.match(/monday\.com\/docs\/([0-9]+)/);
	const value = urlMatch ? urlMatch[1] : raw.trim();
	if (!value) return null;
	if ((isLocator && locator.mode === 'url') || urlMatch) return value;

	const byInternal = await client.execute(
		'query ($ids: [ID!]) { docs(ids: $ids) { object_id } }',
		itemIndex,
		{ ids: [value] },
	);
	const internalHit = ((byInternal.docs ?? []) as IDataObject[])[0];
	if (internalHit?.object_id) return String(internalHit.object_id);

	const byObject = await client.execute(
		'query ($objectIds: [ID!]) { docs(object_ids: $objectIds) { object_id } }',
		itemIndex,
		{ objectIds: [value] },
	);
	const objectHit = ((byObject.docs ?? []) as IDataObject[])[0];
	return objectHit?.object_id ? String(objectHit.object_id) : null;
}

/**
 * The hierarchy mutations answer a bad position reference with a generic
 * "User unauthorized to perform action". Returns a clearer message for a
 * move with a position, or null for other errors.
 */
export function describePositionReferenceError(
	message: string,
	hadPosition: boolean,
): string | null {
	if (!hadPosition || !/user unauthorized/i.test(message)) return null;
	return (
		'monday.com rejected the move with "User unauthorized to perform action". ' +
		'For a position move, this usually means that the reference object in New Position does not exist ' +
		'(wrong ID or wrong reference type), that your API token cannot access it, or that the object cannot be ' +
		'next to it (for example, a folder next to a board that is inside another folder). ' +
		'Check the Reference Object ID and the Reference Object Type.'
	);
}
