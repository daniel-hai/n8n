import {
	type IDataObject,
	type IExecuteFunctions,
	type ILoadOptionsFunctions,
	type INodeProperties,
	type INodePropertyOptions,
	NodeOperationError,
} from 'n8n-workflow';

import { parseDateField } from './filterOptions';
import { mondayError } from './mondayError';
import { MondayGraphQLClient } from '../transport/MondayGraphQLClient';

/**
 * Emails & Activities: custom activity types and the timeline of an item.
 * The API sees only timeline entries that the API created. Entries that
 * users log in monday.com are not visible.
 */

/** The CustomActivityColor enum, grouped by hue like STATUS_COLOR_OPTIONS. */
export const CUSTOM_ACTIVITY_COLOR_OPTIONS: INodePropertyOptions[] = [
	{ name: '⚪ Gray', value: 'GRAY' },
	{ name: '🔴 Brink Pink', value: 'BRINK_PINK' },
	{ name: '🔴 Dingy Dungeon', value: 'DINGY_DUNGEON' },
	{ name: '🔴 Paradise Pink', value: 'PARADISE_PINK' },
	{ name: '🔵 Celtic Blue', value: 'CELTIC_BLUE' },
	{ name: '🔵 Cornflower Blue', value: 'CORNFLOWER_BLUE' },
	{ name: '🔵 Maya Blue', value: 'MAYA_BLUE' },
	{ name: '🔵 Medium Turquoise', value: 'MEDIUM_TURQUOISE' },
	{ name: '🔵 Slate Blue', value: 'SLATE_BLUE' },
	{ name: '🔵 Vivid Cerulean', value: 'VIVID_CERULEAN' },
	{ name: '🔵 Yankees Blue', value: 'YANKEES_BLUE' },
	{ name: '🟠 Yellow Orange', value: 'YELLOW_ORANGE' },
	{ name: '🟡 Philippine Yellow', value: 'PHILIPPINE_YELLOW' },
	{ name: '🟢 Go Green', value: 'GO_GREEN' },
	{ name: '🟢 Philippine Green', value: 'PHILIPPINE_GREEN' },
	{ name: '🟢 Yellow Green', value: 'YELLOW_GREEN' },
	{ name: '🟣 Light Deep Pink', value: 'LIGHT_DEEP_PINK' },
	{ name: '🟣 Light Hot Pink', value: 'LIGHT_HOT_PINK' },
];

/** The CustomActivityIcon enum. The API spells the utensils value UTENCILS. */
export const CUSTOM_ACTIVITY_ICON_OPTIONS: INodePropertyOptions[] = [
	{ name: 'Ascending', value: 'ASCENDING' },
	{ name: 'Camera', value: 'CAMERA' },
	{ name: 'Conference', value: 'CONFERENCE' },
	{ name: 'Flag', value: 'FLAG' },
	{ name: 'Gift', value: 'GIFT' },
	{ name: 'Headphones', value: 'HEADPHONES' },
	{ name: 'Home Keys', value: 'HOMEKEYS' },
	{ name: 'Location', value: 'LOCATION' },
	{ name: 'Notebook', value: 'NOTEBOOK' },
	{ name: 'Paper Plane', value: 'PAPERPLANE' },
	{ name: 'Plane', value: 'PLANE' },
	{ name: 'Pliers', value: 'PLIERS' },
	{ name: 'Tripod', value: 'TRIPOD' },
	{ name: 'Two Flags', value: 'TWOFLAGS' },
	{ name: 'Utensils', value: 'UTENCILS' },
];

export const CUSTOM_ACTIVITY_FIELDS = 'id name type color icon_id';

export const TIMELINE_ITEM_FIELDS = `
	id
	title
	type
	content
	created_at
	custom_activity_id
	user { id name }
	item { id name }
	board { id }
`;

/** The API limit for Title and Summary. */
export const TIMELINE_TEXT_MAX = 255;

export const customActivityProperty: INodeProperties = {
	displayName: 'Custom Activity Name or ID',
	name: 'customActivityId',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getCustomActivitiesList' },
	default: '',
	required: true,
	description:
		'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
};

export const timelineItemIdProperty: INodeProperties = {
	displayName: 'Timeline Item ID',
	name: 'timelineItemId',
	type: 'string',
	default: '',
	required: true,
	placeholder: 'e.g. f06ba628-513f-495d-9f8a-7afa86a9f5e3',
	description: 'The ID of the timeline item. Get it from Create Timeline Item or Get Many.',
};

function assertMaxLength(
	context: IExecuteFunctions,
	value: string,
	fieldName: string,
	itemIndex: number,
): void {
	if (value.length <= TIMELINE_TEXT_MAX) return;
	throw new NodeOperationError(
		context.getNode(),
		`${fieldName} is longer than ${TIMELINE_TEXT_MAX} characters`,
		{ itemIndex, description: `${fieldName} has ${value.length} characters.` },
	);
}

const optionalText = (value: unknown) =>
	typeof value === 'string' && value.trim() !== '' ? value : null;

/**
 * Builds the create_timeline_item variables. Dates use the workflow
 * timezone. The timestamp defaults to now because the API requires it.
 */
export function buildTimelineItemVariables(
	this: IExecuteFunctions,
	title: string,
	fields: IDataObject,
	itemIndex: number,
): IDataObject {
	assertMaxLength(this, title, 'Title', itemIndex);
	const summary = optionalText(fields.summary);
	if (summary) assertMaxLength(this, summary, 'Summary', itemIndex);

	const start = parseDateField.call(this, fields.timeRangeStart, 'Start Time', itemIndex);
	const end = parseDateField.call(this, fields.timeRangeEnd, 'End Time', itemIndex);
	if (Boolean(start) !== Boolean(end)) {
		throw new NodeOperationError(this.getNode(), 'Set both Start Time and End Time', {
			itemIndex,
			description: 'monday.com shows the two values together as the time range.',
		});
	}
	if (start && end && start > end) {
		throw new NodeOperationError(this.getNode(), 'End Time is before Start Time', { itemIndex });
	}

	return {
		title,
		timestamp:
			parseDateField.call(this, fields.timestamp, 'Timestamp', itemIndex) ??
			new Date().toISOString(),
		summary,
		content: optionalText(fields.content),
		location: optionalText(fields.location),
		phone: optionalText(fields.phone),
		url: optionalText(fields.url),
		timeRange: start && end ? { start_timestamp: start, end_timestamp: end } : null,
	};
}

/** Returns the activity, or throws a not-found error. */
export async function assertCustomActivityExists(
	context: IExecuteFunctions,
	client: MondayGraphQLClient,
	customActivityId: string,
	itemIndex: number,
): Promise<IDataObject> {
	const data = await client.execute(
		`query ($ids: [String!]) { custom_activity(ids: $ids) { ${CUSTOM_ACTIVITY_FIELDS} } }`,
		itemIndex,
		{ ids: [customActivityId] },
	);
	const [activity] = Array.isArray(data.custom_activity)
		? (data.custom_activity as IDataObject[])
		: [];
	if (activity) return activity;
	throw new NodeOperationError(
		context.getNode(),
		`Custom activity ${customActivityId} was not found`,
		{ itemIndex, description: 'Choose a custom activity from the list.' },
	);
}

/** monday.com gives NOT_FOUND for an unknown ID and INTERNAL_ERROR for a malformed one. */
export async function withTimelineItemErrors<T>(
	context: IExecuteFunctions,
	itemIndex: number,
	timelineItemId: string,
	request: () => Promise<T>,
): Promise<T> {
	try {
		return await request();
	} catch (error) {
		const { code } = mondayError(error);
		if (code === 'NOT_FOUND' || code === 'INTERNAL_ERROR') {
			throw new NodeOperationError(
				context.getNode(),
				`Timeline item ${timelineItemId} was not found`,
				{
					itemIndex,
					description:
						'Make sure that the ID is correct. The API can see only timeline items that the API created.',
				},
			);
		}
		throw error;
	}
}

/** monday.com gives UNAUTHORIZED for an unknown item ID. */
export async function withTimelineTargetErrors<T>(
	context: IExecuteFunctions,
	itemIndex: number,
	itemId: string,
	request: () => Promise<T>,
): Promise<T> {
	try {
		return await request();
	} catch (error) {
		const { code, message } = mondayError(error);
		if (code === 'UNAUTHORIZED') {
			throw new NodeOperationError(
				context.getNode(),
				`Item ${itemId} was not found, or you have no access to it`,
				{ itemIndex, description: `monday.com returned: ${message}` },
			);
		}
		throw error;
	}
}

/**
 * The custom_activity query returns at most 50 activities, so one request
 * is enough. Names can repeat, so a repeated name also shows the ID.
 */
export async function getCustomActivitiesList(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const client = new MondayGraphQLClient(this);
	const data = await client.execute('query { custom_activity { id name } }', 0);
	const activities = Array.isArray(data.custom_activity)
		? (data.custom_activity as Array<{ id: string; name?: string | null }>)
		: [];
	const nameCounts = new Map<string, number>();
	for (const { name } of activities) {
		if (name) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
	}
	return activities
		.map(({ id, name }) => ({
			name: !name ? id : (nameCounts.get(name) ?? 0) > 1 ? `${name} (${id})` : name,
			value: id,
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}
