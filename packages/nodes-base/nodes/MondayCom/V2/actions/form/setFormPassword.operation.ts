import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { executeFormRequest, formTokenProperty, requireFormToken } from '../../helpers/forms';
import { isPlainJsonObject } from '../../helpers/json';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	formTokenProperty,
	{
		displayName: 'Action',
		name: 'formPasswordAction',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: 'Remove Password',
				value: 'remove',
				description: 'Stop the password protection',
			},
			{
				name: 'Set Password',
				value: 'set',
				description: 'Start the password protection with a new password',
			},
		],
		default: 'set',
		description: 'Whether to set a new password or remove the password',
	},
	{
		displayName: 'Password',
		name: 'formPassword',
		type: 'string',
		typeOptions: { password: true },
		default: '',
		required: true,
		description: 'The password that responders must enter to open the form',
		displayOptions: { show: { formPasswordAction: ['set'] } },
	},
];

const displayOptions = {
	show: {
		resource: ['form'],
		operation: ['setFormPassword'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

function passwordEnabled(form: unknown): boolean {
	if (!isPlainJsonObject(form) || !isPlainJsonObject(form.features)) return false;
	const password = form.features.password;
	return isPlainJsonObject(password) && password.enabled === true;
}

/**
 * Form: Set or Remove Password. set_form_password cannot remove a password,
 * so Remove goes through update_form_settings.
 */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const formToken = requireFormToken.call(this, itemIndex);
	const action = this.getNodeParameter('formPasswordAction', itemIndex, 'set');

	if (action === 'remove') {
		const data = await executeFormRequest.call(
			this,
			client,
			itemIndex,
			formToken,
			`mutation ($formToken: String!) {
				update_form_settings(formToken: $formToken, settings: { features: { password: { enabled: false } } }) {
					features { password { enabled } }
				}
			}`,
			{ formToken },
		);
		return { token: formToken, passwordEnabled: passwordEnabled(data.update_form_settings) };
	}
	if (action !== 'set') {
		throw new NodeOperationError(this.getNode(), `Action "${String(action)}" is not supported`, {
			itemIndex,
			description: 'Use set or remove.',
		});
	}

	const password = String(this.getNodeParameter('formPassword', itemIndex, ''));
	if (password === '') {
		throw new NodeOperationError(this.getNode(), 'Password is empty', { itemIndex });
	}
	const data = await executeFormRequest.call(
		this,
		client,
		itemIndex,
		formToken,
		`mutation ($formToken: String!, $input: SetFormPasswordInput!) {
			set_form_password(formToken: $formToken, input: $input) { features { password { enabled } } }
		}`,
		{ formToken, input: { password } },
	);
	return { token: formToken, passwordEnabled: passwordEnabled(data.set_form_password) };
}
