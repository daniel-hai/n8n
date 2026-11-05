import type { IDataObject, IHookFunctions, IWebhookFunctions } from 'n8n-workflow';
import { runInNewContext } from 'node:vm';
import { describe, it, expect, vi } from 'vitest';

import { MondayComTrigger } from '../MondayComTrigger.node';
import {
	BOARD_EVENT_VALUES,
	COMBINED_EVENT_VALUES,
	MONDAY_WEBHOOK_EVENTS,
} from '../triggerEvents/boardEvents';

const BOARD_ID = '5107264051';
const WEBHOOK_URL = 'https://n8n.example.com/webhook/abc/webhook';

/** Every value of the WebhookEventType enum (introspected live 2026-11). */
const MONDAY_WEBHOOK_EVENT_TYPES = [
	'change_column_value',
	'change_name',
	'change_specific_column_value',
	'change_status_column_value',
	'change_subitem_column_value',
	'change_subitem_name',
	'create_column',
	'create_item',
	'create_subitem',
	'create_subitem_update',
	'create_update',
	'delete_update',
	'edit_update',
	'item_archived',
	'item_deleted',
	'item_moved_to_any_group',
	'item_moved_to_specific_group',
	'item_restored',
	'move_subitem',
	'subitem_archived',
	'subitem_deleted',
];

type Request = { query: string; variables?: IDataObject };
type Responder = (body: Request) => unknown;

function makeContext(params: IDataObject, respond: Responder = () => ({ data: {} })) {
	const staticData: IDataObject = {};
	const request = vi.fn(async (_type: string, options: { body: IDataObject }) =>
		respond(options.body as Request),
	);
	const response = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn(), send: vi.fn() };
	response.status.mockReturnValue(response);
	let body: unknown = {};
	const context = {
		getNode: () => ({ name: 'Monday.com Trigger', type: 'n8n-nodes-base.mondayComTrigger' }),
		getNodeParameter: (
			name: string,
			fallback?: unknown,
			options?: { extractValue?: boolean },
		): unknown => {
			const value = name in params ? params[name] : fallback;
			if (options?.extractValue && value && typeof value === 'object' && 'value' in value) {
				return (value as { value: unknown }).value;
			}
			return value;
		},
		getWorkflowStaticData: () => staticData,
		getNodeWebhookUrl: () => WEBHOOK_URL,
		getBodyData: () => body,
		getResponseObject: () => response,
		helpers: {
			httpRequestWithAuthentication: request,
			returnJsonArray: (items: IDataObject[]) => items.map((json) => ({ json })),
		},
	};
	const sent = () => request.mock.calls.map((call) => call[1].body as Request);
	return {
		hook: context as unknown as IHookFunctions,
		webhook: context as unknown as IWebhookFunctions,
		staticData,
		request,
		sent,
		response,
		setBody: (next: unknown) => {
			body = next;
		},
	};
}

const node = new MondayComTrigger();
const methods = node.webhookMethods.default;
const board = { mode: 'list', value: BOARD_ID };
const graphQlError = (message: string, code: string) => ({
	errors: [{ message, extensions: { code, status_code: 400 } }],
});
/** Answers create_webhook with sequential IDs, and delete_webhook with success. */
function webhookApi(firstId = 100) {
	let next = firstId;
	return ({ query }: Request) =>
		query.includes('create_webhook')
			? { data: { create_webhook: { id: String(next++) } } }
			: { data: { delete_webhook: { id: '0' } } };
}

describe('MondayComTrigger description', () => {
	const eventProperty = node.description.properties.find((property) => property.name === 'event');
	const options = (eventProperty?.options ?? []) as Array<{
		name: string;
		value: string;
		action?: string;
	}>;

	it('covers every monday.com webhook event exactly once', () => {
		expect([...MONDAY_WEBHOOK_EVENTS].sort()).toEqual(MONDAY_WEBHOOK_EVENT_TYPES);
		expect(options.map((option) => option.value)).toEqual(BOARD_EVENT_VALUES);
	});

	it('combines six item events with their subitem events', () => {
		expect(COMBINED_EVENT_VALUES).toEqual([
			'change_column_value',
			'item_archived',
			'create_item',
			'item_deleted',
			'change_name',
			'create_update',
		]);
	});

	it('lists the events in alphabetical order, each with a node creator action', () => {
		const names = options.map((option) => option.name);
		expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
		for (const option of options) expect(option.action).toMatch(/^On /);
	});

	it('supports access token and OAuth2 credentials', () => {
		expect(node.description.credentials?.map((credential) => credential.name)).toEqual([
			'mondayComApi',
			'mondayComOAuth2Api',
		]);
	});

	describe('outputs', () => {
		const expression = String(node.description.outputs)
			.replace(/^=\{\{/, '')
			.replace(/\}\}$/, '');
		// The editor evaluates this expression. The test runs it with a stub $parameter.
		const outputs = (parameter: IDataObject) =>
			runInNewContext(expression, { $parameter: parameter }) as Array<{
				displayName?: string;
			}>;
		const names = (parameter: IDataObject) => outputs(parameter).map((o) => o.displayName);

		it('has Items and Subitems outputs for an item event that watches all items', () => {
			expect(names({ event: 'create_item', itemScope: 'all' })).toEqual(['Items', 'Subitems']);
		});

		it('has one output for a narrowed item scope', () => {
			expect(names({ event: 'create_item', itemScope: 'top' })).toEqual(['Items']);
			expect(names({ event: 'create_update', itemScope: 'subitems' })).toEqual(['Subitems']);
		});

		it('has one output for other board events', () => {
			expect(outputs({ event: 'item_moved_to_any_group', itemScope: 'all' })).toEqual([
				{ type: 'main' },
			]);
		});
	});
});

describe('MondayComTrigger board events: create', () => {
	it.each([
		['change_specific_column_value', { columnId: 'text_1' }, { columnId: 'text_1' }],
		[
			'change_status_column_value',
			{ labelColumnId: 'status', statusLabel: '1' },
			{ columnId: 'status', columnValue: { index: 1 } },
		],
		['item_moved_to_specific_group', { groupId: 'topics' }, { groupId: 'topics' }],
		['item_restored', {}, undefined],
	])('registers %s with the matching config', async (event, extra, config) => {
		const ctx = makeContext({ event, boardId: board, ...extra }, webhookApi());

		await expect(methods.create.call(ctx.hook)).resolves.toBe(true);

		expect(ctx.sent()).toHaveLength(1);
		expect(ctx.sent()[0].variables).toEqual({
			boardId: BOARD_ID,
			url: WEBHOOK_URL,
			event,
			config: config ? JSON.stringify(config) : undefined,
		});
		expect(ctx.staticData.webhookIds).toEqual(['100']);
		expect(typeof ctx.staticData.subscriptionKey).toBe('string');
	});

	it.each([
		['create_item', 'all', ['create_item', 'create_subitem']],
		['create_item', 'top', ['create_item']],
		['create_item', 'subitems', ['create_subitem']],
		['change_column_value', 'all', ['change_column_value', 'change_subitem_column_value']],
		['change_name', 'all', ['change_name', 'change_subitem_name']],
		['item_archived', 'all', ['item_archived', 'subitem_archived']],
		['item_deleted', 'all', ['item_deleted', 'subitem_deleted']],
		['create_update', 'all', ['create_update', 'create_subitem_update']],
	])('registers %s with Items to Watch %s', async (event, itemScope, expected) => {
		const ctx = makeContext({ event, boardId: board, itemScope }, webhookApi());

		await methods.create.call(ctx.hook);

		expect(ctx.sent().map((body) => body.variables?.event)).toEqual(expected);
		expect(ctx.staticData.webhookIds).toEqual(expected.map((_, index) => String(100 + index)));
	});

	it('deletes the stored webhooks before it registers new ones', async () => {
		const ctx = makeContext(
			{ event: 'create_item', boardId: board, itemScope: 'top' },
			webhookApi(),
		);
		ctx.staticData.webhookIds = ['old1', 'old2'];
		ctx.staticData.subscriptionKey = 'stale';

		await methods.create.call(ctx.hook);

		const sent = ctx.sent();
		expect(sent[0].query).toContain('delete_webhook');
		expect(sent[0].variables).toEqual({ id: 'old1' });
		expect(sent[1].variables).toEqual({ id: 'old2' });
		expect(sent[2].query).toContain('create_webhook');
		expect(ctx.staticData.webhookIds).toEqual(['100']);
	});

	it('explains a failed challenge', async () => {
		const ctx = makeContext({ event: 'item_restored', boardId: board }, () =>
			graphQlError(
				'notices.automation.create.webhooks.errors.communication',
				'InvalidArgumentException',
			),
		);

		await expect(methods.create.call(ctx.hook)).rejects.toThrow(
			'monday.com could not reach the webhook URL',
		);
		expect(ctx.staticData.webhookIds).toBeUndefined();
	});

	it('removes the item webhook when the subitem webhook fails', async () => {
		const ctx = makeContext({ event: 'create_item', boardId: board }, ({ query, variables }) => {
			if (query.includes('delete_webhook')) return { data: { delete_webhook: { id: '100' } } };
			return variables?.event === 'create_item'
				? { data: { create_webhook: { id: '100' } } }
				: graphQlError(
						'store.monday.integration.error.missing_subitems_board',
						'InvalidArgumentException',
					);
		});

		await expect(methods.create.call(ctx.hook)).rejects.toThrow('This board has no subitems');

		const last = ctx.sent().at(-1);
		expect(last?.query).toContain('delete_webhook');
		expect(last?.variables).toEqual({ id: '100' });
		expect(ctx.staticData.webhookIds).toBeUndefined();
	});

	it('passes other API errors through', async () => {
		const ctx = makeContext({ event: 'item_restored', boardId: board }, () =>
			graphQlError('Board not found', 'InvalidArgumentException'),
		);

		await expect(methods.create.call(ctx.hook)).rejects.toThrow('Board not found');
	});

	it('fails when monday.com returns no webhook ID', async () => {
		const ctx = makeContext({ event: 'item_restored', boardId: board }, () => ({
			data: { create_webhook: null },
		}));

		await expect(methods.create.call(ctx.hook)).rejects.toThrow(
			'monday.com did not return the new webhook.',
		);
	});

	it('requires a board', async () => {
		const ctx = makeContext({ event: 'create_item', boardId: { mode: 'list', value: '' } });

		await expect(methods.create.call(ctx.hook)).rejects.toThrow('Select a board.');
		expect(ctx.request).not.toHaveBeenCalled();
	});
});

describe('MondayComTrigger board events: checkExists', () => {
	async function registered(params: IDataObject, remoteIds: string[]) {
		const api = webhookApi();
		const ctx = makeContext(params, (body) =>
			body.query.includes('webhooks(')
				? { data: { webhooks: remoteIds.map((id) => ({ id })) } }
				: api(body),
		);
		await methods.create.call(ctx.hook);
		ctx.request.mockClear();
		return ctx;
	}

	it('returns false when nothing is stored', async () => {
		const ctx = makeContext({ event: 'create_item', boardId: board });

		await expect(methods.checkExists.call(ctx.hook)).resolves.toBe(false);
		expect(ctx.request).not.toHaveBeenCalled();
	});

	it('returns true when monday.com still has every stored webhook', async () => {
		const ctx = await registered({ event: 'create_item', boardId: board }, ['7', '100', '101']);

		await expect(methods.checkExists.call(ctx.hook)).resolves.toBe(true);
		expect(ctx.sent()[0].variables).toEqual({ boardId: BOARD_ID });
	});

	it('returns false when monday.com lost one webhook of the pair', async () => {
		const ctx = await registered({ event: 'create_item', boardId: board }, ['100']);

		await expect(methods.checkExists.call(ctx.hook)).resolves.toBe(false);
	});

	it('returns false without an API call when Items to Watch changed', async () => {
		const params: IDataObject = { event: 'create_item', boardId: board, itemScope: 'all' };
		const ctx = await registered(params, ['100', '101']);
		params.itemScope = 'top';

		await expect(methods.checkExists.call(ctx.hook)).resolves.toBe(false);
		expect(ctx.request).not.toHaveBeenCalled();
	});

	it('returns false without an API call when a filter changed', async () => {
		const params: IDataObject = {
			event: 'item_moved_to_specific_group',
			boardId: board,
			groupId: 'a',
		};
		const ctx = await registered(params, ['100']);
		params.groupId = 'b';

		await expect(methods.checkExists.call(ctx.hook)).resolves.toBe(false);
		expect(ctx.request).not.toHaveBeenCalled();
	});

	it('returns false when the list request fails', async () => {
		const ctx = await registered({ event: 'item_restored', boardId: board }, []);
		ctx.request.mockResolvedValue(graphQlError('Board not found', 'InvalidArgumentException'));

		await expect(methods.checkExists.call(ctx.hook)).resolves.toBe(false);
	});
});

describe('MondayComTrigger board events: delete', () => {
	it('deletes every stored webhook and clears the stored state', async () => {
		const ctx = makeContext({ event: 'create_item', boardId: board }, webhookApi());
		ctx.staticData.webhookIds = ['100', '101'];
		ctx.staticData.subscriptionKey = 'key';

		await expect(methods.delete.call(ctx.hook)).resolves.toBe(true);

		expect(ctx.sent().map((body) => body.variables)).toEqual([{ id: '100' }, { id: '101' }]);
		expect(ctx.staticData).toEqual({});
	});

	it('succeeds when a webhook is already gone on monday.com', async () => {
		const ctx = makeContext({ event: 'create_item', boardId: board }, () =>
			graphQlError('User unauthorized to perform action', 'USER_UNAUTHORIZED'),
		);
		ctx.staticData.webhookIds = ['100', '101'];

		await expect(methods.delete.call(ctx.hook)).resolves.toBe(true);
		expect(ctx.request).toHaveBeenCalledTimes(2);
		expect(ctx.staticData.webhookIds).toBeUndefined();
	});
});

describe('MondayComTrigger board events: webhook', () => {
	// Payload shapes captured from live deliveries on 2026-11-05.
	const createItem = {
		app: 'monday',
		type: 'create_pulse',
		subscriptionId: 150212569,
		boardId: 5107264051,
		pulseId: 3332601527,
		pulseName: 'Probe item',
		groupId: 'topics',
	};
	const createSubitem = {
		type: 'create_pulse',
		subscriptionId: 150213087,
		boardId: 5107264420,
		pulseId: 3332590615,
		pulseName: 'Probe subitem',
		parentItemId: 3332601527,
		parentItemBoardId: 5107264051,
	};
	const itemArchived = {
		type: 'archive_pulse',
		subscriptionId: 150212592,
		boardId: 5107264051,
		itemId: 3332601527,
		itemName: 'Probe item',
	};
	const subitemUpdate = {
		type: 'create_update',
		boardId: 5107264420,
		pulseId: 3332585788,
		textBody: 'seed subitem update',
		parentItemId: '3332585579',
	};
	const movedToGroup = {
		type: 'move_pulse_into_group',
		boardId: 5107264051,
		pulseId: 3332601527,
		sourceGroupId: 'topics',
		destGroupId: 'group_1',
	};
	const item = { id: '3332601527', name: 'Probe item', column_values: [] };

	it('answers the registration challenge without starting the workflow', async () => {
		const ctx = makeContext({ event: 'create_item', boardId: board });
		ctx.setBody({ challenge: 'abc' });

		const result = await node.webhook.call(ctx.webhook);

		expect(result).toEqual({ noWebhookResponse: true });
		expect(ctx.response.status).toHaveBeenCalledWith(200);
		expect(ctx.response.json).toHaveBeenCalledWith({ challenge: 'abc' });
	});

	it('outputs the payload of an event without item levels', async () => {
		const ctx = makeContext({ event: 'item_moved_to_any_group', boardId: board });
		ctx.setBody({ event: movedToGroup });

		const result = await node.webhook.call(ctx.webhook);

		expect(result.workflowData).toEqual([[{ json: movedToGroup }]]);
		expect(ctx.request).not.toHaveBeenCalled();
	});

	it.each([
		['an item', createItem, false, 0],
		['a subitem', createSubitem, true, 1],
	])(
		'sends %s to its output when it watches all items',
		async (_label, payload, isSubitem, index) => {
			const ctx = makeContext({ event: 'create_item', boardId: board, itemScope: 'all' });
			ctx.setBody({ event: payload });

			const result = await node.webhook.call(ctx.webhook);

			const expected: Array<Array<{ json: IDataObject }>> = [[], []];
			expected[index] = [{ json: { ...payload, isSubitem } }];
			expect(result.workflowData).toEqual(expected);
		},
	);

	it('uses one output for a narrowed item scope', async () => {
		const ctx = makeContext({ event: 'create_item', boardId: board, itemScope: 'subitems' });
		ctx.setBody({ event: createSubitem });

		const result = await node.webhook.call(ctx.webhook);

		expect(result.workflowData).toEqual([[{ json: { ...createSubitem, isSubitem: true } }]]);
	});

	it('ignores a request without an event', async () => {
		const ctx = makeContext({ event: 'create_item', boardId: board });
		ctx.setBody({ hello: 'world' });

		await expect(node.webhook.call(ctx.webhook)).resolves.toEqual({});
	});

	it.each([
		['create_item', 'top', createItem, '3332601527', 0],
		['item_archived', 'top', itemArchived, '3332601527', 0],
		['create_update', 'all', subitemUpdate, '3332585788', 1],
	])(
		'adds item details for %s when asked',
		async (event, itemScope, payload, itemId, outputIndex) => {
			const ctx = makeContext({ event, boardId: board, itemScope, includeItem: true }, () => ({
				data: { items: [item] },
			}));
			ctx.setBody({ event: payload });

			const result = await node.webhook.call(ctx.webhook);

			expect(ctx.sent()[0].variables).toEqual({ ids: [itemId] });
			expect(result.workflowData?.[outputIndex]?.[0]?.json.item).toEqual(item);
		},
	);

	it('does not fetch a deleted item', async () => {
		const ctx = makeContext({ event: 'item_deleted', boardId: board, includeItem: true });
		ctx.setBody({ event: { ...itemArchived, type: 'delete_pulse' } });

		await node.webhook.call(ctx.webhook);

		expect(ctx.request).not.toHaveBeenCalled();
	});
});

describe('MondayComTrigger unknown event', () => {
	it('throws for an event it does not support', async () => {
		const ctx = makeContext({ event: 'unknown_event' });

		await expect(methods.checkExists.call(ctx.hook)).rejects.toThrow(
			'This trigger event is not supported.',
		);
	});
});
