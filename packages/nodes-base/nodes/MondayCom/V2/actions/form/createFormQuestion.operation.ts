import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import {
	assertQuestionType,
	buildQuestionFields,
	executeFormRequest,
	FORM_QUESTION_FIELDS,
	FORM_QUESTION_TYPE_OPTIONS,
	formTokenProperty,
	mondayError,
	requireFormToken,
} from '../../helpers/forms';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';
import { questionFieldOptions } from './questionFields';

const properties: INodeProperties[] = [
	formTokenProperty,
	{
		displayName: 'Question Title',
		name: 'formQuestionTitle',
		type: 'string',
		default: '',
		required: true,
		description: 'The question text that responders see',
	},
	{
		displayName: 'Question Type',
		name: 'formQuestionType',
		type: 'options',
		options: FORM_QUESTION_TYPE_OPTIONS,
		default: 'ShortText',
		required: true,
		description: 'The type of answer that the question accepts',
	},
	{
		displayName: 'Options',
		name: 'createFormQuestionOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [
			...questionFieldOptions.filter((option) => option.name !== 'title'),
			{
				displayName: 'Existing Column ID',
				name: 'existingColumnId',
				type: 'string',
				default: '',
				description:
					'The ID of a column on the response board to link the question to. Without it, monday.com creates a new column.',
			},
			{
				displayName: 'Insert After Question Name or ID',
				name: 'insertAfterQuestionId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getFormQuestionsList',
					loadOptionsDependsOn: ['formToken'],
				},
				default: '',
				description:
					'The question to add the new question after. Without it, the question goes at the end. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['form'],
		operation: ['createFormQuestion'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Form: Create Question — create_form_question. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const formToken = requireFormToken.call(this, itemIndex);
	const title = String(this.getNodeParameter('formQuestionTitle', itemIndex, '')).trim();
	const type = String(this.getNodeParameter('formQuestionType', itemIndex, ''));
	const options = this.getNodeParameter('createFormQuestionOptions', itemIndex, {}) as IDataObject;

	if (title === '') {
		throw new NodeOperationError(this.getNode(), 'Question Title is empty', { itemIndex });
	}
	assertQuestionType.call(this, type, itemIndex);
	const question: IDataObject = {
		...buildQuestionFields.call(this, type, options, itemIndex),
		title,
		type,
	};
	const insertAfter = String(options.insertAfterQuestionId ?? '').trim();
	if (insertAfter !== '') question.insert_after_question_id = insertAfter;
	const existingColumnId = String(options.existingColumnId ?? '').trim();
	if (existingColumnId !== '') question.existing_column_id = existingColumnId;

	try {
		const data = await executeFormRequest.call(
			this,
			client,
			itemIndex,
			formToken,
			`mutation ($formToken: String!, $question: CreateQuestionInput!) {
				create_form_question(formToken: $formToken, question: $question) { ${FORM_QUESTION_FIELDS} }
			}`,
			{ formToken, question },
		);
		return (data.create_form_question ?? {}) as IDataObject;
	} catch (error) {
		if (mondayError(error).code === 'InsertAfterBlockNotFound') {
			throw new NodeOperationError(
				this.getNode(),
				`Insert After Question: question ${insertAfter} was not found on form ${formToken}`,
				{ itemIndex, description: `monday.com: ${mondayError(error).message}` },
			);
		}
		throw error;
	}
}
