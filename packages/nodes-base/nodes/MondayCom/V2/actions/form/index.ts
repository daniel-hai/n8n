import type { INodeProperties } from 'n8n-workflow';

import * as activateOrDeactivateForm from './activateOrDeactivateForm.operation';
import * as createForm from './createForm.operation';
import * as createFormQuestion from './createFormQuestion.operation';
import * as createFormTag from './createFormTag.operation';
import * as deleteFormQuestion from './deleteFormQuestion.operation';
import * as deleteFormTag from './deleteFormTag.operation';
import * as getForm from './getForm.operation';
import * as setFormPassword from './setFormPassword.operation';
import * as shortenFormUrl from './shortenFormUrl.operation';
import * as updateForm from './updateForm.operation';
import * as updateFormQuestion from './updateFormQuestion.operation';
import * as updateFormSettings from './updateFormSettings.operation';

export {
	activateOrDeactivateForm,
	createForm,
	createFormQuestion,
	createFormTag,
	deleteFormQuestion,
	deleteFormTag,
	getForm,
	setFormPassword,
	shortenFormUrl,
	updateForm,
	updateFormQuestion,
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
				name: 'Create Question',
				value: 'createFormQuestion',
				action: 'Create a form question',
				description: 'Add a question to a form',
			},
			{
				name: 'Create Tag',
				value: 'createFormTag',
				action: 'Create a form tag',
				description:
					'Add a tag to a form. monday.com adds a column for the tag to the response board.',
			},
			{
				name: 'Delete Question',
				value: 'deleteFormQuestion',
				action: 'Delete a form question',
				description: 'Delete a question from a form permanently',
			},
			{
				name: 'Delete Tag',
				value: 'deleteFormTag',
				action: 'Delete a form tag',
				description: 'Delete a tag from a form, with its column if you want',
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
				name: 'Update Question',
				value: 'updateFormQuestion',
				action: 'Update a form question',
				description: 'Change the text, choices or settings of a question',
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
	...createFormQuestion.description,
	...createFormTag.description,
	...deleteFormQuestion.description,
	...deleteFormTag.description,
	...getForm.description,
	...setFormPassword.description,
	...shortenFormUrl.description,
	...updateForm.description,
	...updateFormQuestion.description,
	...updateFormSettings.description,
];
