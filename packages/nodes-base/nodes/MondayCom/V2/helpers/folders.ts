import {
	type IDataObject,
	type IExecuteFunctions,
	type INodePropertyOptions,
	NodeOperationError,
} from 'n8n-workflow';

import type { MondayGraphQLClient } from '../transport/MondayGraphQLClient';

/**
 * Workspace folders. API facts (API 2026-10) that shape this module:
 * - folders(ids, workspace_ids, limit, page) is page-based, at most 100 rows
 *   per page, and flat: sub-folders are their own rows with `parent` set.
 * - workspace_ids: [null] selects the Main workspace. The workspaces query
 *   never lists Main, so null is its only handle.
 * - create_folder with parent_folder_id but no workspace_id fails with
 *   "Folder has different WS than parent folder", also for Main.
 * - update_folder resets the style attributes it does not receive. A name-only
 *   update clears color, icon and font weight. It keeps the parent folder.
 *   parent_folder_id: null moves the folder to the workspace root.
 * - A position without parent_folder_id moves the folder next to the
 *   reference object. A parent_folder_id overrides the position.
 * - delete_folder also deletes everything inside the folder.
 */

/** The folders query rejects limits above 100. */
export const FOLDERS_API_MAX_PAGE_SIZE = 100;

export const FOLDER_FIELDS = `
	id
	name
	color
	custom_icon
	font_weight
	owner_id
	created_at
	workspace { id name }
	parent { id name }
	sub_folders { id name }
`;

/** "No parent" in the Update parent picker. Omitting the argument un-nests the folder. */
export const FOLDER_ROOT_PARENT = '__root__';

/** "None (Default)" in the styling options. Omitting the argument clears the attribute. */
export const FOLDER_ATTRIBUTE_NONE = '__none__';

export const FOLDER_COLOR_OPTIONS: INodePropertyOptions[] = [
	{ name: 'Aquamarine', value: 'AQUAMARINE' },
	{ name: 'Bright Blue', value: 'BRIGHT_BLUE' },
	{ name: 'Bright Green', value: 'BRIGHT_GREEN' },
	{ name: 'Chili Blue', value: 'CHILI_BLUE' },
	{ name: 'Dark Orange', value: 'DARK_ORANGE' },
	{ name: 'Dark Purple', value: 'DARK_PURPLE' },
	{ name: 'Dark Red', value: 'DARK_RED' },
	{ name: 'Done Green', value: 'DONE_GREEN' },
	{ name: 'Indigo', value: 'INDIGO' },
	{ name: 'Lipstick', value: 'LIPSTICK' },
	{ name: 'None (Default)', value: FOLDER_ATTRIBUTE_NONE },
	{ name: 'Purple', value: 'PURPLE' },
	{ name: 'Sofia Pink', value: 'SOFIA_PINK' },
	{ name: 'Stuck Red', value: 'STUCK_RED' },
	{ name: 'Sunset', value: 'SUNSET' },
	{ name: 'Working Orange', value: 'WORKING_ORANGE' },
];

export const FOLDER_ICON_OPTIONS: INodePropertyOptions[] = [
	{ name: 'Folder', value: 'FOLDER' },
	{ name: 'More Below', value: 'MOREBELOW' },
	{ name: 'More Below (Filled)', value: 'MOREBELOWFILLED' },
	{ name: 'None (Default)', value: FOLDER_ATTRIBUTE_NONE },
	{ name: 'Work', value: 'WORK' },
];

export const FOLDER_FONT_WEIGHT_OPTIONS: INodePropertyOptions[] = [
	{ name: 'Bold', value: 'FONT_WEIGHT_BOLD' },
	{ name: 'Light', value: 'FONT_WEIGHT_LIGHT' },
	{ name: 'None (Default)', value: FOLDER_ATTRIBUTE_NONE },
	{ name: 'Normal', value: 'FONT_WEIGHT_NORMAL' },
	{ name: 'Very Light', value: 'FONT_WEIGHT_VERY_LIGHT' },
];

const allowedValues = (options: INodePropertyOptions[]) =>
	new Set(options.map((option) => String(option.value)));

/** Styling field → the enum values the API accepts. Other values never reach the API. */
const FOLDER_STYLE_VALUES: Record<'color' | 'customIcon' | 'fontWeight', Set<string>> = {
	color: allowedValues(FOLDER_COLOR_OPTIONS),
	customIcon: allowedValues(FOLDER_ICON_OPTIONS),
	fontWeight: allowedValues(FOLDER_FONT_WEIGHT_OPTIONS),
};

const FOLDER_STYLE_LABELS = {
	color: 'Color',
	customIcon: 'Custom Icon',
	fontWeight: 'Font Weight',
};

/** Throws when a styling field holds a value outside its enum (for example from an expression). */
export function assertFolderStyleValues(
	this: IExecuteFunctions,
	fields: IDataObject,
	itemIndex: number,
): void {
	for (const field of ['color', 'customIcon', 'fontWeight'] as const) {
		const value = fields[field];
		if (value === undefined || value === '') continue;
		if (!FOLDER_STYLE_VALUES[field].has(String(value))) {
			throw new NodeOperationError(
				this.getNode(),
				`${FOLDER_STYLE_LABELS[field]} "${String(value)}" is not supported`,
				{ itemIndex, description: 'Choose a value from the list.' },
			);
		}
	}
}

/** The current state of a folder, read before an update. */
export interface CurrentFolderState {
	name?: string | null;
	color?: string | null;
	custom_icon?: string | null;
	font_weight?: string | null;
	parent?: { id?: string | null } | null;
}

/** The Update Fields selections. All are optional. */
export interface FolderUpdateChanges {
	name?: string;
	color?: string;
	customIcon?: string;
	fontWeight?: string;
	/** A folder ID, or FOLDER_ROOT_PARENT to move to the workspace root. */
	parentFolderId?: string;
	workspaceId?: string;
}

/** The update_folder arguments to send. Undefined means omit. An omitted style attribute is reset. A null parent means the root. */
export interface UpdateFolderArgs {
	name?: string;
	color?: string;
	customIcon?: string;
	fontWeight?: string;
	parentFolderId?: string | null;
	workspaceId?: string;
}

/**
 * Merges the changes with the current folder state, so attributes the user
 * did not change survive the style reset of update_folder. A move to another
 * workspace without a new parent puts the folder at the root, because the
 * old parent is in the old workspace.
 */
export function buildUpdateFolderArgs(
	current: CurrentFolderState,
	changes: FolderUpdateChanges,
): UpdateFolderArgs {
	const pick = (change: string | undefined, currentValue: string | null | undefined) => {
		if (change === FOLDER_ATTRIBUTE_NONE) return undefined;
		if (change !== undefined && change !== '') return change;
		return currentValue ?? undefined;
	};

	let parentFolderId: string | null | undefined;
	if (changes.parentFolderId === FOLDER_ROOT_PARENT) {
		parentFolderId = null;
	} else if (changes.parentFolderId) {
		parentFolderId = changes.parentFolderId;
	} else if (changes.workspaceId) {
		parentFolderId = null;
	} else {
		parentFolderId = current.parent?.id ?? undefined;
	}

	return {
		name:
			changes.name !== undefined && changes.name !== ''
				? changes.name
				: (current.name ?? undefined),
		color: pick(changes.color, current.color),
		customIcon: pick(changes.customIcon, current.custom_icon),
		fontWeight: pick(changes.fontWeight, current.font_weight),
		parentFolderId,
		workspaceId: changes.workspaceId || undefined,
	};
}

/** Folder dropdown label. The list is flat, so a sub-folder shows as "Parent / Name". */
export function formatFolderLabel(folder: {
	name: string;
	parent?: { name?: string | null } | null;
}): string {
	return folder.parent?.name ? `${folder.parent.name} / ${folder.name}` : folder.name;
}

export function folderNotFoundError(this: IExecuteFunctions, folderId: string, itemIndex: number) {
	return new NodeOperationError(
		this.getNode(),
		`Folder ${folderId} was not found. It may never have existed, or your API token may not have access to its workspace.`,
		{ itemIndex },
	);
}

/** Reads the attributes that update_folder resets. */
export async function fetchFolderState(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	folderId: string,
	itemIndex: number,
): Promise<CurrentFolderState> {
	const data = await client.execute(
		'query ($ids: [ID!]) { folders(ids: $ids) { name color custom_icon font_weight parent { id } } }',
		itemIndex,
		{ ids: [folderId] },
	);
	const current = ((data.folders ?? []) as CurrentFolderState[])[0];
	if (!current) throw folderNotFoundError.call(this, folderId, itemIndex);
	return current;
}

/** Builds the update_folder mutation. Only defined arguments are declared and sent. */
export function buildUpdateFolderMutation(
	folderId: string,
	merged: UpdateFolderArgs,
	position?: IDataObject,
): { query: string; variables: Record<string, unknown> } {
	const varDefs = ['$folderId: ID!'];
	const args = ['folder_id: $folderId'];
	const variables: Record<string, unknown> = { folderId };
	const add = (variable: string, type: string, argument: string, value: unknown) => {
		if (value === undefined) return;
		varDefs.push(`$${variable}: ${type}`);
		args.push(`${argument}: $${variable}`);
		variables[variable] = value;
	};
	add('name', 'String', 'name', merged.name);
	add('color', 'FolderColor', 'color', merged.color);
	add('customIcon', 'FolderCustomIcon', 'custom_icon', merged.customIcon);
	add('fontWeight', 'FolderFontWeight', 'font_weight', merged.fontWeight);
	add('parentFolderId', 'ID', 'parent_folder_id', merged.parentFolderId);
	add('workspaceId', 'ID', 'workspace_id', merged.workspaceId);
	add('position', 'DynamicPosition', 'position', position);

	return {
		query: `mutation (${varDefs.join(', ')}) {
			update_folder(${args.join(', ')}) { ${FOLDER_FIELDS} }
		}`,
		variables,
	};
}
