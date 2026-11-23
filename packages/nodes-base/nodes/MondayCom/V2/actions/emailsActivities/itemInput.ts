import { type IExecuteFunctions, type INodeProperties, NodeOperationError } from 'n8n-workflow';

import { boardResourceLocator } from '../../helpers/boardLocator';
import {
	HIDE_UNTIL_BOARD_SELECTED,
	itemIdTextProperty,
	itemInputModeProperty,
	itemListOnlyResourceLocator,
} from '../../helpers/itemLocator';

/** The item that owns the timeline. The board picker only lists its items. */
export const timelineItemInputProperties: INodeProperties[] = [
	itemInputModeProperty,
	{
		...boardResourceLocator,
		description: 'The board of the item. The node uses it only to list the items.',
		displayOptions: { show: { itemInputMode: ['list'] } },
	},
	{
		...itemListOnlyResourceLocator,
		displayOptions: { show: { itemInputMode: ['list'] }, hide: HIDE_UNTIL_BOARD_SELECTED },
	},
	{ ...itemIdTextProperty, displayOptions: { show: { itemInputMode: ['id'] } } },
];

export function requireTimelineOwnerId(this: IExecuteFunctions, itemIndex: number): string {
	const itemId = String(
		this.getNodeParameter('itemId', itemIndex, '', { extractValue: true }),
	).trim();
	if (itemId) return itemId;
	throw new NodeOperationError(this.getNode(), 'Item is required', { itemIndex });
}
