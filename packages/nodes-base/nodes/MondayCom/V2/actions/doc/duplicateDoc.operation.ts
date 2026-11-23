import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { docResourceLocator } from '../../helpers/docLocator';
import { assertDocMutationSucceeded, readDoc, requireDocId } from '../../helpers/docs';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	docResourceLocator,
	{
		displayName: 'Include Updates',
		name: 'docDuplicateWithUpdates',
		type: 'boolean',
		default: false,
		description: 'Whether the copy also gets the updates (comments) of the doc',
	},
];

const displayOptions = {
	show: {
		resource: ['doc'],
		operation: ['duplicateDoc'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/**
 * Doc: Duplicate. duplicate_doc returns the object ID of the copy, so the
 * node reads the copy to return the same fields as Get. Without a duplicate
 * type, monday.com fails with "Unknown error", so the node always sends one.
 */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const docId = await requireDocId.call(this, client, itemIndex);
	const withUpdates = this.getNodeParameter('docDuplicateWithUpdates', itemIndex, false) === true;

	const data = await client.execute(
		'mutation ($docId: ID!, $duplicateType: DuplicateType) { duplicate_doc(docId: $docId, duplicateType: $duplicateType) }',
		itemIndex,
		{
			docId,
			duplicateType: withUpdates
				? 'duplicate_doc_with_content_and_updates'
				: 'duplicate_doc_with_content',
		},
	);
	const result = (data.duplicate_doc ?? {}) as IDataObject;
	assertDocMutationSucceeded.call(this, result, `duplicate doc ${docId}`, itemIndex);

	const objectId = String(result.id);
	return (await readDoc(client, itemIndex, objectId, 'objectId')) ?? { object_id: objectId };
}
