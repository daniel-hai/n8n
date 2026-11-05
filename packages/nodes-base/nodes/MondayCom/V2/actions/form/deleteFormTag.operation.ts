import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { withArchiveOrDeleteOutcome } from '../../helpers/archiveOrDelete';
import {
	assertFormMutationSucceeded,
	executeFormRequest,
	formTokenProperty,
	requireFormToken,
} from '../../helpers/forms';
import { isPlainJsonObject } from '../../helpers/json';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	formTokenProperty,
	{
		displayName: 'Tag Name or ID',
		name: 'formTagId',
		type: 'options',
		typeOptions: {
			loadOptionsMethod: 'getFormTagsList',
			loadOptionsDependsOn: ['formToken'],
		},
		default: '',
		required: true,
		description:
			'The tag to delete. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Options',
		name: 'deleteFormTagOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [
			{
				displayName: 'Delete Column',
				name: 'deleteAssociatedColumn',
				type: 'boolean',
				default: false,
				description:
					'Whether to also delete the column of the tag on the response board, with its values',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['form'],
		operation: ['deleteFormTag'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/**
 * Form: Delete Tag — delete_form_tag. monday.com returns true also for an
 * unknown tag ID, so the node checks the tags first.
 */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const formToken = requireFormToken.call(this, itemIndex);
	const tagId = String(this.getNodeParameter('formTagId', itemIndex, '')).trim();
	const options = this.getNodeParameter('deleteFormTagOptions', itemIndex, {}) as IDataObject;

	const current = await executeFormRequest.call(
		this,
		client,
		itemIndex,
		formToken,
		'query ($formToken: String!) { form(formToken: $formToken) { tags { id name } } }',
		{ formToken },
	);
	const form = isPlainJsonObject(current.form) ? current.form : {};
	const tags = Array.isArray(form.tags) ? form.tags.filter(isPlainJsonObject) : [];
	const tag = tags.find((entry) => String(entry.id) === tagId);
	if (!tag) {
		throw new NodeOperationError(
			this.getNode(),
			`Tag ${tagId} was not found on form ${formToken}`,
			{
				itemIndex,
				description: tags.length
					? `The form has these tags: ${tags.map((entry) => `${String(entry.name)} (${String(entry.id)})`).join(', ')}.`
					: 'The form has no tags.',
			},
		);
	}

	const deleteColumn = options.deleteAssociatedColumn === true;
	const data = await executeFormRequest.call(
		this,
		client,
		itemIndex,
		formToken,
		`mutation ($formToken: String!, $tagId: String!, $options: DeleteFormTagInput) {
			delete_form_tag(formToken: $formToken, tagId: $tagId, options: $options)
		}`,
		{ formToken, tagId, options: deleteColumn ? { deleteAssociatedColumn: true } : null },
	);
	assertFormMutationSucceeded.call(this, data.delete_form_tag, `delete tag ${tagId}`, itemIndex);
	return withArchiveOrDeleteOutcome(
		{ token: formToken, tagId, name: tag.name ?? null, columnDeleted: deleteColumn },
		'delete',
		'tag',
	);
}
