import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { withArchiveOrDeleteOutcome } from '../../helpers/archiveOrDelete';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';
import { folderIdProperty, folderWorkspaceProperty } from '../common.description';

const properties: INodeProperties[] = [
	folderWorkspaceProperty,
	folderIdProperty,
	{
		displayName:
			'Deleting a folder also deletes everything inside it, including its boards and sub-folders. You cannot undo this with the API.',
		name: 'deleteFolderNotice',
		type: 'notice',
		default: '',
	},
];

const displayOptions = {
	show: {
		resource: ['folder'],
		operation: ['deleteFolder'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const folderId = String(this.getNodeParameter('folderId', itemIndex));
	const data = await client.execute(
		'mutation ($folderId: ID!) { delete_folder(folder_id: $folderId) { id name } }',
		itemIndex,
		{ folderId },
	);
	return withArchiveOrDeleteOutcome(
		(data.delete_folder ?? { id: folderId }) as IDataObject,
		'delete',
		'folder',
	);
}
