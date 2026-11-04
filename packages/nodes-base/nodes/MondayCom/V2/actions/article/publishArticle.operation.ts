import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import {
	ARTICLE_METADATA_FIELDS,
	ARTICLE_PRIVACY_OPTIONS,
	articleObjectIdProperty,
	requireArticleId,
	withArticleErrors,
} from '../../helpers/articles';
import {
	buildUserRowsProperty,
	extractUserRowIds,
	splitUserTeamIds,
} from '../../helpers/userLocator';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const PRIVACY_KINDS = new Set(ARTICLE_PRIVACY_OPTIONS.map((option) => String(option.value)));
const whenPrivate = { show: { articlePrivacyKind: ['PRIVATE'] } };

const properties: INodeProperties[] = [
	articleObjectIdProperty,
	{
		displayName: 'Privacy',
		name: 'articlePrivacyKind',
		type: 'options',
		options: ARTICLE_PRIVACY_OPTIONS,
		default: 'PUBLIC',
		required: true,
		description: 'Who can see the published article',
	},
	buildUserRowsProperty({
		displayName: 'Subscribers to Add',
		name: 'articleAddSubscribers',
		includeTeams: true,
		description:
			'The users and teams to add as subscribers of the private article. In expression mode, pass a comma-separated string of user IDs and <code>team:&lt;ID&gt;</code> values.',
		displayOptions: whenPrivate,
	}),
	buildUserRowsProperty({
		displayName: 'Subscribers to Remove',
		name: 'articleRemoveSubscribers',
		includeTeams: true,
		description:
			'The users and teams to remove from the subscribers of the private article. In expression mode, pass a comma-separated string of user IDs and <code>team:&lt;ID&gt;</code> values.',
		displayOptions: whenPrivate,
	}),
	{
		displayName: 'Options',
		name: 'publishArticleOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [
			{
				displayName: 'Folder ID',
				name: 'folderId',
				type: 'string',
				default: '',
				description:
					'The folder to put the published article in. Without it, the article stays where it is.',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['article'],
		operation: ['publishArticle'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

const idsOrNull = (ids: string[]) => (ids.length > 0 ? ids : null);

/** Article: Publish — publish_article sets the privacy and, for a private article, the subscribers. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const objectId = requireArticleId.call(this, itemIndex);
	const privacyKind = String(this.getNodeParameter('articlePrivacyKind', itemIndex, 'PUBLIC'));
	if (!PRIVACY_KINDS.has(privacyKind)) {
		throw new NodeOperationError(this.getNode(), `Privacy "${privacyKind}" is not supported`, {
			itemIndex,
			description: 'Use PUBLIC or PRIVATE.',
		});
	}
	const options = this.getNodeParameter('publishArticleOptions', itemIndex, {}) as IDataObject;
	const folderId = String(options.folderId ?? '').trim();

	// The subscriber fields are hidden for a public article, so ignore their stored values.
	const isPrivate = privacyKind === 'PRIVATE';
	const add = splitUserTeamIds(
		isPrivate
			? extractUserRowIds(this.getNodeParameter('articleAddSubscribers', itemIndex, {}))
			: [],
	);
	const remove = splitUserTeamIds(
		isPrivate
			? extractUserRowIds(this.getNodeParameter('articleRemoveSubscribers', itemIndex, {}))
			: [],
	);

	const data = await withArticleErrors(
		this,
		itemIndex,
		async () =>
			await client.execute(
				`mutation ($objectId: ID!, $privacyKind: PrivacyKind!, $folderId: ID, $addSubscriberIds: [ID!], $addSubscriberTeamIds: [ID!], $removeSubscriberIds: [ID!], $removeSubscriberTeamIds: [ID!]) {
				publish_article(
					object_id: $objectId,
					privacy_kind: $privacyKind,
					folder_id: $folderId,
					add_subscriber_ids: $addSubscriberIds,
					add_subscriber_team_ids: $addSubscriberTeamIds,
					remove_subscriber_ids: $removeSubscriberIds,
					remove_subscriber_team_ids: $removeSubscriberTeamIds
				) { ${ARTICLE_METADATA_FIELDS} }
			}`,
				itemIndex,
				{
					objectId,
					privacyKind,
					folderId: folderId || null,
					addSubscriberIds: idsOrNull(add.userIds),
					addSubscriberTeamIds: idsOrNull(add.teamIds),
					removeSubscriberIds: idsOrNull(remove.userIds),
					removeSubscriberTeamIds: idsOrNull(remove.teamIds),
				},
			),
	);
	return (data.publish_article ?? {}) as IDataObject;
}
