import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { docResourceLocator } from '../../helpers/docLocator';
import { assertDocMutationSucceeded, requireDocId } from '../../helpers/docs';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	docResourceLocator,
	{
		displayName: 'New Name',
		name: 'docNewName',
		type: 'string',
		default: '',
		required: true,
		description: 'The new name of the doc',
	},
];

const displayOptions = {
	show: {
		resource: ['doc'],
		operation: ['renameDoc'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Doc: Rename — update_doc_name. The name is the only doc attribute the API can change. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const docId = await requireDocId.call(this, client, itemIndex);
	const name = this.getNodeParameter('docNewName', itemIndex) as string;

	const data = await client.execute(
		'mutation ($docId: ID!, $name: String!) { update_doc_name(docId: $docId, name: $name) }',
		itemIndex,
		{ docId, name },
	);
	const result = (data.update_doc_name ?? {}) as IDataObject;
	assertDocMutationSucceeded.call(this, result, `rename doc ${docId}`, itemIndex);
	return { id: docId, name: result.name ?? name };
}
