import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import { execute as createFolder } from '../actions/folder/createFolder.operation';
import { execute as deleteFolder } from '../actions/folder/deleteFolder.operation';
import { execute as getFolders } from '../actions/folder/getFolders.operation';
import { execute as getWorkspaceObjects } from '../actions/folder/getWorkspaceObjects.operation';
import { execute as moveObject } from '../actions/folder/moveObject.operation';
import { execute as updateFolder } from '../actions/folder/updateFolder.operation';
import {
	buildUpdateFolderArgs,
	buildUpdateFolderMutation,
	FOLDER_ATTRIBUTE_NONE,
	FOLDER_ROOT_PARENT,
} from '../helpers/folders';
import {
	buildWorkspaceObjectRows,
	buildWorkspaceObjectTree,
	describePositionReferenceError,
	mapLeftPaneBoardRow,
	type WorkspaceObjectRow,
} from '../helpers/workspaceObjects';
import type { MondayGraphQLClient } from '../transport/MondayGraphQLClient';

function makeContext(params: Record<string, unknown>): IExecuteFunctions {
	return {
		getNodeParameter: (name: string, _index: number, fallback?: unknown) =>
			params[name] !== undefined ? params[name] : fallback,
		getNode: () => ({ name: 'monday.com', type: 'n8n-nodes-base.mondayCom', typeVersion: 2 }),
	} as unknown as IExecuteFunctions;
}

function makeClient(...responses: IDataObject[]) {
	const execute = vi.fn();
	for (const response of responses) execute.mockResolvedValueOnce(response);
	return { client: { execute } as unknown as MondayGraphQLClient, execute };
}

const call = (execute: ReturnType<typeof vi.fn>, index: number) =>
	execute.mock.calls[index] as unknown as [string, number, Record<string, unknown>];

const styledFolder = {
	name: 'Projects',
	color: 'INDIGO',
	custom_icon: null,
	font_weight: 'FONT_WEIGHT_BOLD',
	parent: { id: '5' },
};

describe('buildUpdateFolderArgs', () => {
	it('keeps the current values of the attributes that do not change', () => {
		expect(buildUpdateFolderArgs(styledFolder, { name: 'Renamed' })).toEqual({
			name: 'Renamed',
			color: 'INDIGO',
			customIcon: undefined,
			fontWeight: 'FONT_WEIGHT_BOLD',
			parentFolderId: '5',
			workspaceId: undefined,
		});
	});

	it('clears an attribute set to None', () => {
		const args = buildUpdateFolderArgs(styledFolder, { color: FOLDER_ATTRIBUTE_NONE });
		expect(args.color).toBeUndefined();
		expect(args.fontWeight).toBe('FONT_WEIGHT_BOLD');
	});

	it('sends a null parent for the workspace root and for a workspace move', () => {
		expect(
			buildUpdateFolderArgs(styledFolder, { parentFolderId: FOLDER_ROOT_PARENT }).parentFolderId,
		).toBeNull();
		expect(buildUpdateFolderArgs(styledFolder, { workspaceId: '9' })).toMatchObject({
			parentFolderId: null,
			workspaceId: '9',
		});
	});
});

describe('buildUpdateFolderMutation', () => {
	it('declares only the arguments it sends, and sends a null parent', () => {
		const { query, variables } = buildUpdateFolderMutation('7', {
			name: 'Projects',
			parentFolderId: null,
		});
		expect(query).toContain('$name: String');
		expect(query).toContain('parent_folder_id: $parentFolderId');
		expect(query).not.toContain('$color');
		expect(variables).toEqual({ folderId: '7', name: 'Projects', parentFolderId: null });
	});
});

describe('Folder: Create', () => {
	it('sends the workspace of the parent folder when no workspace is set', async () => {
		const { client, execute } = makeClient(
			{ folders: [{ workspace: { id: '42' } }] },
			{ create_folder: { id: '8', name: 'Child' } },
		);
		const result = await createFolder.call(
			makeContext({
				folderName: 'Child',
				createFolderOptions: { parentFolderId: '5', color: FOLDER_ATTRIBUTE_NONE },
			}),
			client,
			0,
		);

		expect(call(execute, 0)[2]).toEqual({ ids: ['5'] });
		const [query, , variables] = call(execute, 1);
		expect(query).not.toContain('$color');
		expect(variables).toEqual({ name: 'Child', workspaceId: '42', parentFolderId: '5' });
		expect(result.id).toBe('8');
	});

	it('rejects a style value that is not in the list', async () => {
		const { client, execute } = makeClient();
		await expect(
			createFolder.call(
				makeContext({ folderName: 'X', createFolderOptions: { color: 'PINK) { id }' } }),
				client,
				0,
			),
		).rejects.toThrow('Color "PINK) { id }" is not supported');
		expect(execute).not.toHaveBeenCalled();
	});
});

describe('Folder: Update', () => {
	it('reads the folder first and sends its style again', async () => {
		const { client, execute } = makeClient(
			{ folders: [styledFolder] },
			{ update_folder: { id: '7', name: 'Renamed' } },
		);
		await updateFolder.call(
			makeContext({ folderId: '7', updateFolderFields: { name: 'Renamed' } }),
			client,
			0,
		);

		expect(call(execute, 1)[2]).toEqual({
			folderId: '7',
			name: 'Renamed',
			color: 'INDIGO',
			fontWeight: 'FONT_WEIGHT_BOLD',
			parentFolderId: '5',
		});
	});

	it('rejects an empty update', async () => {
		const { client, execute } = makeClient();
		await expect(
			updateFolder.call(makeContext({ folderId: '7', updateFolderFields: {} }), client, 0),
		).rejects.toThrow('Add at least one field to Update Fields');
		expect(execute).not.toHaveBeenCalled();
	});

	it('throws a not found error for an unknown folder', async () => {
		const { client } = makeClient({ folders: [] });
		await expect(
			updateFolder.call(
				makeContext({ folderId: '404', updateFolderFields: { name: 'X' } }),
				client,
				0,
			),
		).rejects.toThrow('Folder 404 was not found');
	});
});

describe('Folder: Delete', () => {
	it('returns the deleted folder with the delete outcome', async () => {
		const { client, execute } = makeClient({ delete_folder: { id: '7', name: 'Old' } });
		const result = await deleteFolder.call(makeContext({ folderId: '7' }), client, 0);

		expect(call(execute, 0)[2]).toEqual({ folderId: '7' });
		expect(result).toEqual({ id: '7', name: 'Old', deleted: true, action: 'delete' });
	});
});

describe('Folder: Get Many Folders', () => {
	it('sends the filters as variables and keeps only real boards in children', async () => {
		const { client, execute } = makeClient({
			folders: [
				{
					id: '7',
					name: 'Projects',
					children: [
						{ id: '1', name: 'Board', type: 'board' },
						{ id: '2', name: 'Subitems of Board', type: 'sub_items_board' },
						{ id: '3', name: 'Doc', type: 'document' },
					],
				},
			],
		});
		const rows = await getFolders.call(
			makeContext({
				getFoldersOptions: { folderIds: '7, 8', workspaceIds: ['9'], includeBoards: true },
			}),
			client,
			0,
		);

		const [query, , variables] = call(execute, 0);
		expect(query).toContain('children { id name type }');
		expect(variables).toMatchObject({ ids: ['7', '8'], workspaceIds: ['9'], page: 1 });
		expect((rows[0].children as IDataObject[]).map((child) => child.id)).toEqual(['1']);
	});

	it('does not request children when boards are not included', async () => {
		const { client, execute } = makeClient({ folders: [] });
		await getFolders.call(makeContext({ getFoldersOptions: {} }), client, 0);
		expect(call(execute, 0)[0]).not.toContain('children');
	});
});

const folderRow = (id: string, name: string, folderId: string | null): WorkspaceObjectRow => ({
	objectType: 'folder',
	id,
	name,
	folderId,
	workspaceId: '1',
});
const boardRow = (id: string, name: string, folderId: string | null): WorkspaceObjectRow => ({
	objectType: 'board',
	id,
	name,
	folderId,
	workspaceId: '1',
});

describe('workspace object rows', () => {
	it('maps board types and drops subitem boards', () => {
		expect(mapLeftPaneBoardRow({ id: '1', name: 'Doc', type: 'document' })?.objectType).toBe('doc');
		expect(mapLeftPaneBoardRow({ id: '2', name: 'Sub', type: 'sub_items_board' })).toBeNull();
	});

	it('lists folders first, each group sorted by name', () => {
		const rows = buildWorkspaceObjectRows(
			[folderRow('f2', 'Zeta', null), folderRow('f1', 'Alpha', null)],
			[boardRow('b1', 'Beta', null)],
			[],
		);
		expect(rows.map((row) => row.id)).toEqual(['f1', 'f2', 'b1']);
	});

	it('nests folder contents and keeps orphan objects at the root', () => {
		const tree = buildWorkspaceObjectTree(
			[folderRow('f1', 'Parent', null), folderRow('f2', 'Child', 'f1')],
			[boardRow('b1', 'In child', 'f2'), boardRow('b2', 'Orphan', 'missing')],
		);
		expect(tree.map((row) => row.id)).toEqual(['f1', 'b2']);
		const child = tree[0].children?.[0];
		expect(child?.id).toBe('f2');
		expect(child?.children?.map((row) => row.id)).toEqual(['b1']);
	});
});

describe('Folder: Get Many Objects', () => {
	it('uses the Main workspace handle when no workspace is set', async () => {
		const { client, execute } = makeClient(
			{ folders: [{ id: 'f1', name: 'Projects', parent: null, workspace: { id: '1' } }] },
			{ boards: [{ id: 'b1', name: 'Board', type: 'board', board_folder_id: 'f1' }] },
		);
		const rows = await getWorkspaceObjects.call(
			makeContext({ objectsOutputStructure: 'tree' }),
			client,
			0,
		);

		expect(call(execute, 0)[2]).toMatchObject({ workspaceIds: [null] });
		expect(rows).toHaveLength(1);
		expect((rows[0].children as IDataObject[])[0].id).toBe('b1');
	});

	it('skips the boards query when only folders are requested', async () => {
		const { client, execute } = makeClient({ folders: [] });
		await getWorkspaceObjects.call(
			makeContext({ getObjectsOptions: { objectTypes: ['folder'] } }),
			client,
			0,
		);
		expect(execute).toHaveBeenCalledTimes(1);
	});

	it('rejects an object type that is not in the list', async () => {
		const { client } = makeClient();
		await expect(
			getWorkspaceObjects.call(
				makeContext({ getObjectsOptions: { objectTypes: ['board', 'widget'] } }),
				client,
				0,
			),
		).rejects.toThrow('Object type "widget" is not supported');
	});
});

describe('Folder: Move Object', () => {
	it('moves a board into a destination folder', async () => {
		const { client, execute } = makeClient({
			update_board_hierarchy: { success: true, board: { id: '1' } },
		});
		const result = await moveObject.call(
			makeContext({ moveObjectType: 'board', boardId: '1', moveDestination: { folderId: '7' } }),
			client,
			0,
		);

		expect(call(execute, 0)[2]).toEqual({ boardId: '1', attributes: { folder_id: '7' } });
		expect(result.objectType).toBe('board');
	});

	it('resolves a doc URL to its object ID without a lookup', async () => {
		const { client, execute } = makeClient({ update_board_hierarchy: { success: true } });
		await moveObject.call(
			makeContext({
				moveObjectType: 'doc',
				docId: { mode: 'url', value: 'https://acme.monday.com/docs/555' },
				moveDestination: { folderId: '7' },
			}),
			client,
			0,
		);

		expect(execute).toHaveBeenCalledTimes(1);
		expect(call(execute, 0)[2]).toMatchObject({ boardId: '555' });
	});

	it('throws a not found error for an unknown doc', async () => {
		const { client } = makeClient({ docs: [] }, { docs: [] });
		await expect(
			moveObject.call(
				makeContext({
					moveObjectType: 'doc',
					docId: { mode: 'id', value: '404' },
					moveDestination: { folderId: '7' },
				}),
				client,
				0,
			),
		).rejects.toThrow('The doc was not found');
	});

	it('moves a folder by position alone, without its current parent', async () => {
		const { client, execute } = makeClient(
			{ folders: [styledFolder] },
			{ update_folder: { id: '7' } },
		);
		const result = await moveObject.call(
			makeContext({
				moveObjectType: 'folder',
				folderId: '7',
				movePosition: { objectId: '3', objectType: 'Folder', placement: 'before' },
			}),
			client,
			0,
		);

		const variables = call(execute, 1)[2];
		expect(variables).not.toHaveProperty('parentFolderId');
		expect(variables).toMatchObject({
			color: 'INDIGO',
			position: { object_id: '3', object_type: 'Folder', is_after: false },
		});
		expect(result).toMatchObject({ objectType: 'folder', moved: true });
	});

	it('rejects a move without a position or a destination', async () => {
		const { client } = makeClient();
		await expect(
			moveObject.call(makeContext({ moveObjectType: 'board', boardId: '1' }), client, 0),
		).rejects.toThrow('Set a New Position or a Destination');
	});

	it('rejects an object type that is not in the list', async () => {
		const { client } = makeClient();
		await expect(
			moveObject.call(
				makeContext({ moveObjectType: 'widget', moveDestination: { folderId: '7' } }),
				client,
				0,
			),
		).rejects.toThrow('Object Type "widget" is not supported');
	});

	it('explains a generic unauthorized error after a position move', async () => {
		const execute = vi.fn().mockRejectedValue(new Error('User unauthorized to perform action'));
		const client = { execute } as unknown as MondayGraphQLClient;
		await expect(
			moveObject.call(
				makeContext({
					moveObjectType: 'board',
					boardId: '1',
					movePosition: { objectId: '99', objectType: 'Board' },
				}),
				client,
				0,
			),
		).rejects.toThrow('Check the Reference Object ID');
		expect(describePositionReferenceError('User unauthorized', false)).toBeNull();
	});
});
