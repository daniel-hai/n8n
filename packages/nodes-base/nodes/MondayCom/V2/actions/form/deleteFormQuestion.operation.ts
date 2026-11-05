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
import { mondayError } from '../../helpers/mondayError';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';
import { formQuestionProperty } from './questionFields';

const properties: INodeProperties[] = [
	formTokenProperty,
	{
		...formQuestionProperty,
		description:
			'The question to delete. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Deleting a question cannot be undone with the API',
		name: 'deleteFormQuestionNotice',
		type: 'notice',
		default: '',
	},
];

const displayOptions = {
	show: {
		resource: ['form'],
		operation: ['deleteFormQuestion'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Form: Delete Question — delete_question. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const formToken = requireFormToken.call(this, itemIndex);
	const questionId = String(this.getNodeParameter('formQuestionId', itemIndex, '')).trim();

	let data: IDataObject;
	try {
		data = await executeFormRequest.call(
			this,
			client,
			itemIndex,
			formToken,
			'mutation ($formToken: String!, $questionId: String!) { delete_question(formToken: $formToken, questionId: $questionId) }',
			{ formToken, questionId },
		);
	} catch (error) {
		if (mondayError(error).code === 'QuestionNotFound') {
			throw new NodeOperationError(
				this.getNode(),
				`Question ${questionId} was not found on form ${formToken}`,
				{ itemIndex, description: `monday.com: ${mondayError(error).message}` },
			);
		}
		throw error;
	}
	assertFormMutationSucceeded.call(
		this,
		data.delete_question,
		`delete question ${questionId}`,
		itemIndex,
	);
	return withArchiveOrDeleteOutcome({ token: formToken, questionId }, 'delete', 'question');
}
