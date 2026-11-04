import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { normalizeIdList } from '../../helpers/filterOptions';
import {
	executeFormRequest,
	formTokenProperty,
	formUrl,
	requireFormToken,
} from '../../helpers/forms';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	formTokenProperty,
	{
		displayName: 'Update Fields',
		name: 'updateFormFields',
		type: 'collection',
		placeholder: 'Add field',
		default: {},
		options: [
			{
				displayName: 'Description',
				name: 'description',
				type: 'string',
				default: '',
				description: 'The new description of the form. The form shows it below the title.',
			},
			{
				displayName: 'Question Order',
				name: 'questionOrder',
				type: 'string',
				default: '',
				placeholder: 'e.g. name, email_1, single_select_2',
				description:
					'Comma-separated question IDs in the new order. The listed questions move to the start. The other questions keep their order after them. Get the IDs with the Get operation.',
			},
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				default: '',
				description: 'The new title of the form',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['form'],
		operation: ['updateForm'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/**
 * Form: Update — update_form. monday.com ignores an unknown question ID in
 * the order and moves questions anyway, so the node checks the IDs first.
 */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const formToken = requireFormToken.call(this, itemIndex);
	const fields = this.getNodeParameter('updateFormFields', itemIndex, {}) as IDataObject;

	const input: IDataObject = {};
	if (typeof fields.title === 'string' && fields.title.trim() !== '') input.title = fields.title;
	if (typeof fields.description === 'string' && fields.description !== '') {
		input.description = fields.description;
	}
	const orderIds = [...new Set(normalizeIdList(fields.questionOrder))];
	if (orderIds.length > 0) {
		const current = await executeFormRequest.call(
			this,
			client,
			itemIndex,
			formToken,
			'query ($formToken: String!) { form(formToken: $formToken) { questions { id } } }',
			{ formToken },
		);
		const form = (current.form ?? {}) as IDataObject;
		const questions = (form.questions ?? []) as IDataObject[];
		const known = new Set(questions.map((question) => String(question.id)));
		const unknown = orderIds.filter((id) => !known.has(id));
		if (unknown.length > 0) {
			throw new NodeOperationError(
				this.getNode(),
				`Question Order: ${unknown.length === 1 ? 'question' : 'questions'} ${unknown.join(', ')} ${unknown.length === 1 ? 'was' : 'were'} not found on form ${formToken}`,
				{ itemIndex, description: `The form has these question IDs: ${[...known].join(', ')}.` },
			);
		}
		input.questions = orderIds.map((id) => ({ id }));
	}
	if (Object.keys(input).length === 0) {
		throw new NodeOperationError(
			this.getNode(),
			'Add at least one field to update: Title, Description or Question Order',
			{ itemIndex },
		);
	}

	const data = await executeFormRequest.call(
		this,
		client,
		itemIndex,
		formToken,
		`mutation ($formToken: String!, $input: UpdateFormInput!) {
			update_form(formToken: $formToken, input: $input) {
				id
				token
				title
				description
				questions { id title type }
			}
		}`,
		{ formToken, input },
	);
	return { ...((data.update_form ?? {}) as IDataObject), formUrl: formUrl(formToken) };
}
