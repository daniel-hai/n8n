import type { INodeProperties } from 'n8n-workflow';

import * as activateOrDeactivateForm from './activateOrDeactivateForm.operation';
import * as createForm from './createForm.operation';
import * as getForm from './getForm.operation';
import * as setFormPassword from './setFormPassword.operation';
import * as shortenFormUrl from './shortenFormUrl.operation';
import * as updateForm from './updateForm.operation';
import * as updateFormSettings from './updateFormSettings.operation';

export {
	activateOrDeactivateForm,
	createForm,
	getForm,
	setFormPassword,
	shortenFormUrl,
	updateForm,
	updateFormSettings,
};

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['form'] } },
		options: [
			{
				name: 'Activate or Deactivate',
				value: 'activateOrDeactivateForm',
				action: 'Activate or deactivate a form',
				description: 'Start or stop new responses to a form',
			},
			{
				name: 'Create',
				value: 'createForm',
				action: 'Create a form',
				description: 'Create a form and the board that stores its responses',
			},
			{
				name: 'Get',
				value: 'getForm',
				action: 'Get a form',
				description: 'Return the settings, appearance, questions and tags of a form',
			},
			{
				name: 'Set or Remove Password',
				value: 'setFormPassword',
				action: 'Set or remove a form password',
				description: 'Protect a form with a password, or remove the password',
			},
			{
				name: 'Shorten URL',
				value: 'shortenFormUrl',
				action: 'Shorten a form URL',
				description: 'Return a short wkf.ms link to share a form',
			},
			{
				name: 'Update',
				value: 'updateForm',
				action: 'Update a form',
				description: 'Change the title, description or question order of a form',
			},
			{
				name: 'Update Settings',
				value: 'updateFormSettings',
				action: 'Update form settings',
				description: 'Change the features, appearance and accessibility settings of a form',
			},
		],
		default: 'getForm',
	},
	...activateOrDeactivateForm.description,
	...createForm.description,
	...getForm.description,
	...setFormPassword.description,
	...shortenFormUrl.description,
	...updateForm.description,
	...updateFormSettings.description,
];
