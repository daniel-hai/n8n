import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import {
	assertFormMutationSucceeded,
	executeFormRequest,
	formTokenProperty,
	requireFormToken,
} from '../../helpers/forms';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	formTokenProperty,
	{
		displayName: 'Action',
		name: 'formActiveAction',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: 'Activate',
				value: 'activate',
				description: 'Show the form and accept new responses',
			},
			{
				name: 'Deactivate',
				value: 'deactivate',
				description:
					'Hide the form and stop new responses. monday.com then blocks all other operations on the form, also Get, until you activate it again.',
			},
		],
		default: 'activate',
		description: 'Whether to activate or deactivate the form',
	},
];

const displayOptions = {
	show: {
		resource: ['form'],
		operation: ['activateOrDeactivateForm'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Form: Activate or Deactivate — activate_form or deactivate_form. Both return a Boolean. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const formToken = requireFormToken.call(this, itemIndex);
	const action = this.getNodeParameter('formActiveAction', itemIndex, 'activate');
	if (action !== 'activate' && action !== 'deactivate') {
		throw new NodeOperationError(this.getNode(), `Action "${String(action)}" is not supported`, {
			itemIndex,
			description: 'Use activate or deactivate.',
		});
	}

	const field = action === 'activate' ? 'activate_form' : 'deactivate_form';
	const data = await executeFormRequest.call(
		this,
		client,
		itemIndex,
		formToken,
		`mutation ($formToken: String!) { ${field}(formToken: $formToken) }`,
		{ formToken },
	);
	assertFormMutationSucceeded.call(this, data[field], `${action} form ${formToken}`, itemIndex);
	return { token: formToken, active: action === 'activate' };
}
