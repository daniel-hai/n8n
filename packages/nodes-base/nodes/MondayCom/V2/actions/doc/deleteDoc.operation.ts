import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { withArchiveOrDeleteOutcome } from '../../helpers/archiveOrDelete';
import { docResourceLocator } from '../../helpers/docLocator';
import { assertDocMutationSucceeded, requireDocId } from '../../helpers/docs';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	docResourceLocator,
	{
		displayName:
			'Deleting a doc also deletes all of its content. You cannot undo this with the API.',
		name: 'deleteDocNotice',
		type: 'notice',
		default: '',
	},
];

const displayOptions = {
	show: {
		resource: ['doc'],
		operation: ['deleteDoc'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Doc: Delete — delete_doc. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const docId = await requireDocId.call(this, client, itemIndex);
	const data = await client.execute(
		'mutation ($docId: ID!) { delete_doc(docId: $docId) }',
		itemIndex,
		{
			docId,
		},
	);
	assertDocMutationSucceeded.call(
		this,
		(data.delete_doc ?? {}) as IDataObject,
		`delete doc ${docId}`,
		itemIndex,
	);
	return withArchiveOrDeleteOutcome({ id: docId }, 'delete', 'doc');
}
