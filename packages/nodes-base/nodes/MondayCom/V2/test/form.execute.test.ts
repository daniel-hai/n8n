import type { IDataObject, IExecuteFunctions, INode, JsonObject } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import { execute as activateOrDeactivateForm } from '../actions/form/activateOrDeactivateForm.operation';
import { execute as createForm } from '../actions/form/createForm.operation';
import { execute as getForm } from '../actions/form/getForm.operation';
import { execute as setFormPassword } from '../actions/form/setFormPassword.operation';
import { execute as shortenFormUrl } from '../actions/form/shortenFormUrl.operation';
import { execute as updateForm } from '../actions/form/updateForm.operation';
import { execute as updateFormSettings } from '../actions/form/updateFormSettings.operation';
import { deepMergeObjects, extractFormToken } from '../helpers/forms';
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

function makeContext(params: Record<string, unknown>, timezone = 'UTC'): IExecuteFunctions {
	return {
		getNodeParameter: (name: string, _index: number, fallback?: unknown) =>
			params[name] !== undefined ? params[name] : fallback,
		getNode: () => node,
		getTimezone: () => timezone,
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

describe('extractFormToken', () => {
	it('accepts a token and a full form URL', () => {
		expect(extractFormToken(` ${TOKEN} `)).toBe(TOKEN);
		expect(extractFormToken(`https://forms.monday.com/forms/${TOKEN}?r=use1`)).toBe(TOKEN);
	});

	it('rejects a short link, an empty value and other text', () => {
		expect(extractFormToken('https://wkf.ms/4ky4duA')).toBeNull();
		expect(extractFormToken('')).toBeNull();
		expect(extractFormToken('bad-token!')).toBeNull();
		expect(extractFormToken(42)).toBeNull();
	});
});

describe('deepMergeObjects', () => {
	it('merges nested objects and replaces other values', () => {
		expect(
			deepMergeObjects(
				{ features: { requireLogin: { enabled: true } }, is_anonymous: false },
				{ features: { reCaptchaChallenge: true }, is_anonymous: true },
			),
		).toEqual({
			features: { requireLogin: { enabled: true }, reCaptchaChallenge: true },
			is_anonymous: true,
		});
	});
});

describe('Form: Get', () => {
	it('reads the form by the token from the URL and adds the form URL', async () => {
		const { client, execute } = makeClient({ form: { id: 1, token: TOKEN } });
		const ctx = makeContext({ formToken: `https://forms.monday.com/forms/${TOKEN}` });

		const result = await getForm.call(ctx, client, 0);

		expect(call(execute, 0)[2]).toEqual({ formToken: TOKEN });
		expect(result).toEqual({
			id: 1,
			token: TOKEN,
			formUrl: `https://forms.monday.com/forms/${TOKEN}`,
		});
	});

	it('rejects a short link before it sends a request', async () => {
		const { client, execute } = makeClient();
		const ctx = makeContext({ formToken: 'https://wkf.ms/abc' });

		await expect(getForm.call(ctx, client, 0)).rejects.toThrow(
			'Form Token is not a form token or form URL',
		);
		expect(execute).not.toHaveBeenCalled();
	});

	it.each([
		['USER_UNAUTHORIZED', 'User unauthorized to perform action', `Form ${TOKEN} was not found`],
		['FormDeleted', 'Form was deleted.', `Form ${TOKEN} was not found`],
		['DeactivatedForm', 'This form is deactivated.', `Form ${TOKEN} is deactivated`],
		['InvalidFormToken', 'Invalid form token format.', `Form Token "${TOKEN}" is not valid`],
	])('replaces the monday.com %s error with a clear message', async (code, message, expected) => {
		const { client } = makeClient(mondayError(code, message));
		const ctx = makeContext({ formToken: TOKEN });

		await expect(getForm.call(ctx, client, 0)).rejects.toThrow(expected);
	});

	it('keeps other errors as they are', async () => {
		const error = mondayError('ComplexityException', 'Too complex');
		const { client } = makeClient(error);

		await expect(getForm.call(makeContext({ formToken: TOKEN }), client, 0)).rejects.toBe(error);
	});
});

describe('Form: Create', () => {
	it('sends the options as variables and returns the form URL', async () => {
		const { client, execute } = makeClient({ create_form: { boardId: '9', token: TOKEN } });
		const ctx = makeContext({
			formWorkspaceId: '7',
			createFormOptions: {
				boardKind: 'private',
				destinationName: 'Responses',
				destinationFolderId: '3',
				ownerIds: { rows: [{ user: { mode: 'list', value: 'team:5' } }] },
				subscriberIds: '11',
			},
		});

		const result = await createForm.call(ctx, client, 0);

		expect(call(execute, 0)[2]).toEqual({
			workspaceId: '7',
			boardKind: 'private',
			name: 'Responses',
			folderId: '3',
			ownerIds: null,
			ownerTeamIds: ['5'],
			subscriberIds: ['11'],
			subscriberTeamIds: null,
		});
		expect(result).toEqual({
			boardId: '9',
			token: TOKEN,
			formUrl: `https://forms.monday.com/forms/${TOKEN}`,
		});
	});

	it('does not send an owner as a subscriber too', async () => {
		const { client, execute } = makeClient({ create_form: { boardId: '9', token: TOKEN } });
		const ctx = makeContext({
			formWorkspaceId: '7',
			createFormOptions: { ownerIds: '11', subscriberIds: '11,12' },
		});

		await createForm.call(ctx, client, 0);

		expect(call(execute, 0)[2]).toMatchObject({ ownerIds: ['11'], subscriberIds: ['12'] });
	});

	it('rejects a board kind that is not in the list', async () => {
		const { client, execute } = makeClient();
		const ctx = makeContext({ formWorkspaceId: '7', createFormOptions: { boardKind: 'secret' } });

		await expect(createForm.call(ctx, client, 0)).rejects.toThrow(
			'Board Kind "secret" is not supported',
		);
		expect(execute).not.toHaveBeenCalled();
	});

	it('says which workspace was not found', async () => {
		const { client } = makeClient(mondayError('USER_UNAUTHORIZED', 'User unauthorized'));

		await expect(createForm.call(makeContext({ formWorkspaceId: '1' }), client, 0)).rejects.toThrow(
			'Workspace 1 was not found, or you have no access to it',
		);
	});
});

describe('Form: Update', () => {
	it('checks the question order IDs, then sends the update', async () => {
		const { client, execute } = makeClient(
			{ form: { questions: [{ id: 'name' }, { id: 'email' }] } },
			{ update_form: { id: 1, title: 'New' } },
		);
		const ctx = makeContext({
			formToken: TOKEN,
			updateFormFields: { title: 'New', questionOrder: 'email, name, email' },
		});

		const result = await updateForm.call(ctx, client, 0);

		expect(call(execute, 1)[2]).toEqual({
			formToken: TOKEN,
			input: { title: 'New', questions: [{ id: 'email' }, { id: 'name' }] },
		});
		expect(result).toMatchObject({ title: 'New', formUrl: expect.stringContaining(TOKEN) });
	});

	it('fails on an unknown question ID and does not change the form', async () => {
		const { client, execute } = makeClient({ form: { questions: [{ id: 'name' }] } });
		const ctx = makeContext({ formToken: TOKEN, updateFormFields: { questionOrder: 'name,nope' } });

		await expect(updateForm.call(ctx, client, 0)).rejects.toThrow(
			`Question Order: question nope was not found on form ${TOKEN}`,
		);
		expect(execute).toHaveBeenCalledTimes(1);
	});

	it('needs at least one field', async () => {
		const { client, execute } = makeClient();

		await expect(updateForm.call(makeContext({ formToken: TOKEN }), client, 0)).rejects.toThrow(
			'Add at least one field to update',
		);
		expect(execute).not.toHaveBeenCalled();
	});
});

describe('Form: Update Settings', () => {
	it('builds the settings input and reads the close date in the workflow timezone', async () => {
		const { client, execute } = makeClient({ update_form_settings: { id: 1 } });
		const ctx = makeContext(
			{
				formToken: TOKEN,
				formSettingsFields: {
					anonymousResponses: true,
					closeDate: '2026-12-01T10:00:00',
					responseLimit: 5,
					submitButtonText: 'Send',
					rawSettings: '{"appearance":{"showProgressBar":true}}',
				},
			},
			'Asia/Jerusalem',
		);

		await updateFormSettings.call(ctx, client, 0);

		expect(call(execute, 0)[2].settings).toEqual({
			is_anonymous: true,
			appearance: { submitButton: { text: 'Send' }, showProgressBar: true },
			features: {
				responseLimit: { enabled: true, limit: 5 },
				closeDate: { enabled: true, date: '2026-12-01T08:00:00.000Z' },
			},
		});
	});

	it('turns off the limit for 0 and removes the close date', async () => {
		const { client, execute } = makeClient({ update_form_settings: { id: 1 } });
		const ctx = makeContext({
			formToken: TOKEN,
			formSettingsFields: { responseLimit: 0, removeCloseDate: true, closeDate: '2026-12-01' },
		});

		await updateFormSettings.call(ctx, client, 0);

		expect(call(execute, 0)[2].settings).toEqual({
			features: { responseLimit: { enabled: false }, closeDate: { enabled: false } },
		});
	});

	it.each([
		[{ closeDate: 'not a date' }, 'Close Date is not a valid date'],
		[{ rawSettings: '[1]' }, 'Raw Settings (JSON) is not a JSON object'],
		[{ responseLimit: 1.5 }, 'Response Limit is not a whole number'],
		[{}, 'Add at least one setting to update'],
	])('rejects %j before it sends a request', async (fields, message) => {
		const { client, execute } = makeClient();
		const ctx = makeContext({ formToken: TOKEN, formSettingsFields: fields });

		await expect(updateFormSettings.call(ctx, client, 0)).rejects.toThrow(message);
		expect(execute).not.toHaveBeenCalled();
	});
});

describe('Form: Activate or Deactivate', () => {
	it.each([
		['activate', 'activate_form', true],
		['deactivate', 'deactivate_form', false],
	])('%s sends %s', async (action, field, active) => {
		const { client, execute } = makeClient({ [field]: true });
		const ctx = makeContext({ formToken: TOKEN, formActiveAction: action });

		expect(await activateOrDeactivateForm.call(ctx, client, 0)).toEqual({ token: TOKEN, active });
		expect(call(execute, 0)[0]).toContain(field);
	});

	it('fails when monday.com does not return true', async () => {
		const { client } = makeClient({ activate_form: false });
		const ctx = makeContext({ formToken: TOKEN, formActiveAction: 'activate' });

		await expect(activateOrDeactivateForm.call(ctx, client, 0)).rejects.toThrow(
			`monday.com could not activate form ${TOKEN}`,
		);
	});
});

describe('Form: Set or Remove Password', () => {
	it('sets a password with set_form_password', async () => {
		const { client, execute } = makeClient({
			set_form_password: { features: { password: { enabled: true } } },
		});
		const ctx = makeContext({ formToken: TOKEN, formPasswordAction: 'set', formPassword: 'pw' });

		expect(await setFormPassword.call(ctx, client, 0)).toEqual({
			token: TOKEN,
			passwordEnabled: true,
		});
		expect(call(execute, 0)[2]).toEqual({ formToken: TOKEN, input: { password: 'pw' } });
	});

	it('removes a password with update_form_settings', async () => {
		const { client, execute } = makeClient({
			update_form_settings: { features: { password: { enabled: false } } },
		});
		const ctx = makeContext({ formToken: TOKEN, formPasswordAction: 'remove' });

		expect(await setFormPassword.call(ctx, client, 0)).toEqual({
			token: TOKEN,
			passwordEnabled: false,
		});
		expect(call(execute, 0)[0]).toContain('password: { enabled: false }');
	});

	it('rejects an empty password', async () => {
		const { client, execute } = makeClient();
		const ctx = makeContext({ formToken: TOKEN, formPasswordAction: 'set', formPassword: '' });

		await expect(setFormPassword.call(ctx, client, 0)).rejects.toThrow('Password is empty');
		expect(execute).not.toHaveBeenCalled();
	});
});

describe('Form: Shorten URL', () => {
	it('returns the short link with the full form URL', async () => {
		const { client } = makeClient({
			shorten_form_url: { enabled: true, url: 'https://wkf.ms/abc' },
		});

		expect(await shortenFormUrl.call(makeContext({ formToken: TOKEN }), client, 0)).toEqual({
			token: TOKEN,
			formUrl: `https://forms.monday.com/forms/${TOKEN}`,
			enabled: true,
			url: 'https://wkf.ms/abc',
		});
	});
});
