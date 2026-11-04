import type { INodeProperties } from 'n8n-workflow';

/** The question fields that Create Question and Update Question share. */
export const questionFieldOptions: INodeProperties[] = [
	{
		displayName: 'Choices',
		name: 'optionLabels',
		type: 'string',
		default: '',
		placeholder: 'e.g. Small, Medium, Large',
		description:
			'Comma-separated choices for a Single Select or Multi Select question. On Update, they replace the current choices.',
	},
	{
		displayName: 'Description',
		name: 'description',
		type: 'string',
		default: '',
		description: 'More text below the question, for example instructions',
	},
	{
		displayName: 'Required',
		name: 'required',
		type: 'boolean',
		default: false,
		description: 'Whether responders must answer the question',
	},
	{
		displayName: 'Settings (JSON)',
		name: 'settingsJson',
		type: 'json',
		default: '',
		description:
			'A FormQuestionSettingsInput object with settings for the question type, for example <code>{"includeTime": true}</code> for a date. See the <a href="https://developer.monday.com/api-reference/reference/forms-other-types#formquestionsettingsinput">monday.com docs</a>.',
	},
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		default: '',
		description: 'The new question text',
	},
	{
		displayName: 'Visible',
		name: 'visible',
		type: 'boolean',
		default: true,
		description: 'Whether responders see the question. A hidden question stays in the form.',
	},
];

export const formQuestionProperty: INodeProperties = {
	displayName: 'Question Name or ID',
	name: 'formQuestionId',
	type: 'options',
	typeOptions: {
		loadOptionsMethod: 'getFormQuestionsList',
		loadOptionsDependsOn: ['formToken'],
	},
	default: '',
	required: true,
	description:
		'The question to change. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
};
