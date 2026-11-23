import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import {
	executeFormRequest,
	formTokenProperty,
	mondayError,
	requireFormToken,
} from '../../helpers/forms';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	formTokenProperty,
	{
		displayName: 'Tag Name',
		name: 'formTagName',
		type: 'string',
		default: '',
		required: true,
		description:
			'The name of the tag. It must be unique in the form. To rename a tag, delete it and create a new one.',
	},
];

const displayOptions = {
	show: {
		resource: ['form'],
		operation: ['createFormTag'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/**
 * Form: Create Tag — create_form_tag. monday.com also adds a text column for
 * the tag to the response board and returns its ID as columnId.
 */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const formToken = requireFormToken.call(this, itemIndex);
	const name = String(this.getNodeParameter('formTagName', itemIndex, '')).trim();
	if (name === '') {
		throw new NodeOperationError(this.getNode(), 'Tag Name is empty', { itemIndex });
	}

	try {
		const data = await executeFormRequest.call(
			this,
			client,
			itemIndex,
			formToken,
			`mutation ($formToken: String!, $tag: CreateFormTagInput!) {
				create_form_tag(formToken: $formToken, tag: $tag) { id name columnId }
			}`,
			{ formToken, tag: { name } },
		);
		return (data.create_form_tag ?? {}) as IDataObject;
	} catch (error) {
		if (mondayError(error).code === 'TagAlreadyExists') {
			throw new NodeOperationError(
				this.getNode(),
				`Tag Name: form ${formToken} already has a tag "${name}"`,
				{ itemIndex, description: `monday.com: ${mondayError(error).message}` },
			);
		}
		throw error;
	}
}
