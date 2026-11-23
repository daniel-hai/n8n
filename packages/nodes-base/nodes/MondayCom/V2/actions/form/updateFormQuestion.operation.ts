import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import {
	buildQuestionFields,
	executeFormRequest,
	FORM_QUESTION_FIELDS,
	formTokenProperty,
	questionNotFoundError,
	readFormQuestions,
	requireFormToken,
} from '../../helpers/forms';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';
import { formQuestionProperty, questionFieldOptions } from './questionFields';

const properties: INodeProperties[] = [
	formTokenProperty,
	formQuestionProperty,
	{
		displayName: 'Update Fields',
		name: 'updateFormQuestionFields',
		type: 'collection',
		placeholder: 'Add field',
		default: {},
		options: questionFieldOptions,
	},
];

const displayOptions = {
	show: {
		resource: ['form'],
		operation: ['updateFormQuestion'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/**
 * Form: Update Question — update_form_question. The API needs the type on
 * every update and changes the type if it differs, so the node sends the
 * current type.
 */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const formToken = requireFormToken.call(this, itemIndex);
	const questionId = String(this.getNodeParameter('formQuestionId', itemIndex, '')).trim();
	const fields = this.getNodeParameter('updateFormQuestionFields', itemIndex, {}) as IDataObject;

	const questions = await readFormQuestions.call(this, client, itemIndex, formToken);
	const existing = questions.find((question) => question.id === questionId);
	if (!existing) {
		throw questionNotFoundError.call(this, questionId, formToken, questions, itemIndex);
	}

	const changes = buildQuestionFields.call(this, existing.type, fields, itemIndex);
	if (Object.keys(changes).length === 0) {
		throw new NodeOperationError(this.getNode(), 'Add at least one field to update', {
			itemIndex,
		});
	}

	const data = await executeFormRequest.call(
		this,
		client,
		itemIndex,
		formToken,
		`mutation ($formToken: String!, $questionId: String!, $question: UpdateQuestionInput!) {
			update_form_question(formToken: $formToken, questionId: $questionId, question: $question) { ${FORM_QUESTION_FIELDS} }
		}`,
		{ formToken, questionId, question: { ...changes, type: existing.type } },
	);
	return (data.update_form_question ?? {}) as IDataObject;
}
