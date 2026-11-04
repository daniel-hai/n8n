import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INode,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import { execute as createFormQuestion } from '../actions/form/createFormQuestion.operation';
import { execute as createFormTag } from '../actions/form/createFormTag.operation';
import { execute as deleteFormQuestion } from '../actions/form/deleteFormQuestion.operation';
import { execute as deleteFormTag } from '../actions/form/deleteFormTag.operation';
import { execute as updateFormQuestion } from '../actions/form/updateFormQuestion.operation';
import { getFormQuestionsList, getFormTagsList } from '../helpers/forms';
import type { MondayGraphQLClient } from '../transport/MondayGraphQLClient';

const node: INode = {
	id: '1',
	name: 'monday.com',
	type: 'n8n-nodes-base.mondayCom',
	typeVersion: 2,
	position: [0, 0],
	parameters: {},
};
const TOKEN = '4e03ad5c19a193b2973a9aecee176552';

function makeContext(params: Record<string, unknown>): IExecuteFunctions {
	return {
		getNodeParameter: (name: string, _index: number, fallback?: unknown) =>
			params[name] !== undefined ? params[name] : fallback,
		getNode: () => node,
	} as unknown as IExecuteFunctions;
}

function makeClient(...responses: Array<IDataObject | Error>) {
	const execute = vi.fn();
	for (const response of responses) {
		if (response instanceof Error) execute.mockRejectedValueOnce(response);
		else execute.mockResolvedValueOnce(response);
	}
	return { client: { execute } as unknown as MondayGraphQLClient, execute };
}

const call = (execute: ReturnType<typeof vi.fn>, index: number) =>
	execute.mock.calls[index] as unknown as [string, number, Record<string, unknown>];

const mondayError = (code: string, message: string) =>
	new NodeApiError(node, { message, extensions: { code } } as unknown as JsonObject, { message });

const questions = {
	form: {
		questions: [
			{ id: 'name', title: 'Name', type: 'Name' },
			{ id: 'size', title: 'Size', type: 'SingleSelect' },
		],
	},
};

describe('Form: Create Question', () => {
	it('sends the question with its choices and placement', async () => {
		const { client, execute } = makeClient({ create_form_question: { id: 'size' } });
		const ctx = makeContext({
			formToken: TOKEN,
			formQuestionTitle: ' Size ',
			formQuestionType: 'SingleSelect',
			createFormQuestionOptions: {
				optionLabels: 'S, M ,,L',
				required: true,
				insertAfterQuestionId: 'name',
				settingsJson: '{"display":"Dropdown"}',
			},
		});

		expect(await createFormQuestion.call(ctx, client, 0)).toEqual({ id: 'size' });
		expect(call(execute, 0)[2]).toEqual({
			formToken: TOKEN,
			question: {
				title: 'Size',
				type: 'SingleSelect',
				required: true,
				options: [{ label: 'S' }, { label: 'M' }, { label: 'L' }],
				settings: { display: 'Dropdown' },
				insert_after_question_id: 'name',
			},
		});
	});

	it.each([
		[{ formQuestionType: 'Bogus' }, 'Question Type "Bogus" is not supported'],
		[
			{ createFormQuestionOptions: { optionLabels: 'A' } },
			'Choices work only with Single Select and Multi Select questions',
		],
		[{ formQuestionTitle: ' ' }, 'Question Title is empty'],
		[
			{ createFormQuestionOptions: { settingsJson: 'nope' } },
			'Settings (JSON) is not a JSON object',
		],
	])('rejects %j before it sends a request', async (override, message) => {
		const { client, execute } = makeClient();
		const ctx = makeContext({
			formToken: TOKEN,
			formQuestionTitle: 'Q',
			formQuestionType: 'ShortText',
			...override,
		});

		await expect(createFormQuestion.call(ctx, client, 0)).rejects.toThrow(message);
		expect(execute).not.toHaveBeenCalled();
	});

	it('names the Insert After question when monday.com cannot find it', async () => {
		const { client } = makeClient(mondayError('InsertAfterBlockNotFound', 'Tried to insert'));
		const ctx = makeContext({
			formToken: TOKEN,
			formQuestionTitle: 'Q',
			formQuestionType: 'ShortText',
			createFormQuestionOptions: { insertAfterQuestionId: 'nope' },
		});

		await expect(createFormQuestion.call(ctx, client, 0)).rejects.toThrow(
			`Insert After Question: question nope was not found on form ${TOKEN}`,
		);
	});
});

describe('Form: Update Question', () => {
	it('sends the current type of the question with the changes', async () => {
		const { client, execute } = makeClient(questions, { update_form_question: { id: 'size' } });
		const ctx = makeContext({
			formToken: TOKEN,
			formQuestionId: 'size',
			updateFormQuestionFields: { title: 'Shirt size', optionLabels: 'XL', visible: false },
		});

		await updateFormQuestion.call(ctx, client, 0);

		expect(call(execute, 1)[2]).toEqual({
			formToken: TOKEN,
			questionId: 'size',
			question: {
				type: 'SingleSelect',
				title: 'Shirt size',
				visible: false,
				options: [{ label: 'XL' }],
			},
		});
	});

	it('fails on an unknown question and lists the question IDs', async () => {
		const { client, execute } = makeClient(questions);
		const ctx = makeContext({
			formToken: TOKEN,
			formQuestionId: 'nope',
			updateFormQuestionFields: { title: 'X' },
		});

		await expect(updateFormQuestion.call(ctx, client, 0)).rejects.toThrow(
			`Question nope was not found on form ${TOKEN}`,
		);
		expect(execute).toHaveBeenCalledTimes(1);
	});

	it('uses the current type to check the choices', async () => {
		const { client } = makeClient(questions);
		const ctx = makeContext({
			formToken: TOKEN,
			formQuestionId: 'name',
			updateFormQuestionFields: { optionLabels: 'A' },
		});

		await expect(updateFormQuestion.call(ctx, client, 0)).rejects.toThrow(
			'Choices work only with Single Select and Multi Select questions',
		);
	});

	it('needs at least one field', async () => {
		const { client } = makeClient(questions);
		const ctx = makeContext({ formToken: TOKEN, formQuestionId: 'name' });

		await expect(updateFormQuestion.call(ctx, client, 0)).rejects.toThrow(
			'Add at least one field to update',
		);
	});
});

describe('Form: Delete Question', () => {
	it('returns a delete outcome', async () => {
		const { client } = makeClient({ delete_question: true });
		const ctx = makeContext({ formToken: TOKEN, formQuestionId: 'size' });

		expect(await deleteFormQuestion.call(ctx, client, 0)).toEqual({
			token: TOKEN,
			questionId: 'size',
			deleted: true,
			action: 'delete',
		});
	});

	it('names the question that monday.com cannot find', async () => {
		const { client } = makeClient(mondayError('QuestionNotFound', 'Question not found.'));
		const ctx = makeContext({ formToken: TOKEN, formQuestionId: 'nope' });

		await expect(deleteFormQuestion.call(ctx, client, 0)).rejects.toThrow(
			`Question nope was not found on form ${TOKEN}`,
		);
	});
});

describe('Form: Create Tag', () => {
	it('returns the tag with its column', async () => {
		const tag = { id: 't1', name: 'utm', columnId: 'short_text1' };
		const { client, execute } = makeClient({ create_form_tag: tag });
		const ctx = makeContext({ formToken: TOKEN, formTagName: ' utm ' });

		expect(await createFormTag.call(ctx, client, 0)).toEqual(tag);
		expect(call(execute, 0)[2]).toEqual({ formToken: TOKEN, tag: { name: 'utm' } });
	});

	it('names the tag that already exists', async () => {
		const { client } = makeClient(mondayError('TagAlreadyExists', 'Tag name must be unique.'));
		const ctx = makeContext({ formToken: TOKEN, formTagName: 'utm' });

		await expect(createFormTag.call(ctx, client, 0)).rejects.toThrow(
			`Tag Name: form ${TOKEN} already has a tag "utm"`,
		);
	});
});

describe('Form: Delete Tag', () => {
	it('checks the tag, then deletes it with its column', async () => {
		const { client, execute } = makeClient(
			{ form: { tags: [{ id: 't1', name: 'utm' }] } },
			{ delete_form_tag: true },
		);
		const ctx = makeContext({
			formToken: TOKEN,
			formTagId: 't1',
			deleteFormTagOptions: { deleteAssociatedColumn: true },
		});

		expect(await deleteFormTag.call(ctx, client, 0)).toEqual({
			token: TOKEN,
			tagId: 't1',
			name: 'utm',
			columnDeleted: true,
			deleted: true,
			action: 'delete',
		});
		expect(call(execute, 1)[2]).toEqual({
			formToken: TOKEN,
			tagId: 't1',
			options: { deleteAssociatedColumn: true },
		});
	});

	it('fails on an unknown tag and does not send the delete', async () => {
		const { client, execute } = makeClient({ form: { tags: [{ id: 't1', name: 'utm' }] } });
		const ctx = makeContext({ formToken: TOKEN, formTagId: 'nope' });

		await expect(deleteFormTag.call(ctx, client, 0)).rejects.toThrow(
			`Tag nope was not found on form ${TOKEN}`,
		);
		expect(execute).toHaveBeenCalledTimes(1);
	});
});

describe('form loaders', () => {
	function makeLoadContext(formToken: string) {
		const httpRequestWithAuthentication = vi.fn();
		const context = {
			getCurrentNodeParameter: (name: string) => (name === 'formToken' ? formToken : undefined),
			getNodeParameter: (name: string) => (name === 'authentication' ? 'accessToken' : undefined),
			getNode: () => node,
			helpers: { httpRequestWithAuthentication },
		} as unknown as ILoadOptionsFunctions;
		return { context, httpRequestWithAuthentication };
	}

	it('lists the questions of the form in the URL', async () => {
		const { context, httpRequestWithAuthentication } = makeLoadContext(
			`https://forms.monday.com/forms/${TOKEN}`,
		);
		httpRequestWithAuthentication.mockResolvedValueOnce({ data: questions });

		expect(await getFormQuestionsList.call(context)).toEqual([
			{ name: 'Name (Name)', value: 'name' },
			{ name: 'Size (SingleSelect)', value: 'size' },
		]);
	});

	it('lists the tags, and nothing without a usable token', async () => {
		const { context, httpRequestWithAuthentication } = makeLoadContext(TOKEN);
		httpRequestWithAuthentication.mockResolvedValueOnce({
			data: { form: { tags: [{ id: 't1', name: 'Campaign' }] } },
		});

		expect(await getFormTagsList.call(context)).toEqual([{ name: 'Campaign', value: 't1' }]);
		expect(await getFormTagsList.call(makeLoadContext('https://wkf.ms/x').context)).toEqual([]);
	});
});
