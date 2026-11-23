import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { searchAcrossAccount } from '../../helpers/accountSearchRequest';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';
import {
	includeLiveDataProperty,
	searchOptionsProperty,
	searchQueryProperty,
} from '../common.description';

const properties: INodeProperties[] = [
	searchQueryProperty,
	includeLiveDataProperty,
	searchOptionsProperty,
];

const displayOptions = {
	show: {
		resource: ['emailsActivities'],
		operation: ['searchTimelineItemsAccount'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Emails & Activities: Search Timeline Items. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject[]> {
	return await searchAcrossAccount.call(this, client, itemIndex, 'searchTimelineItemsAccount');
}
