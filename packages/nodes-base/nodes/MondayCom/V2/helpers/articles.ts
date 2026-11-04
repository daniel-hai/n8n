import {
	type IExecuteFunctions,
	type INodeProperties,
	type INodePropertyOptions,
	NodeOperationError,
} from 'n8n-workflow';

import { mondayError } from './mondayError';

/**
 * monday.com Knowledge Base articles. The articles query returns only
 * published articles and needs their IDs, so the node cannot list drafts
 * or offer an article picker.
 */

export const ARTICLE_METADATA_FIELDS = `
	object_id
	draft_article_id
	published_article_id
	name
	privacy_kind
	workspace_id
	folder_id
	state
	updated_at
	creator
	owners { id name }
	subscribers { id name }
`;

export const ARTICLE_BLOCK_FIELDS = `
	id
	type
	content
	position
	parent_block_id
	published_article_id
	created_at
	updated_at
	created_by { id name }
`;

export const KB_SNIPPET_FIELDS = `
	id
	title
	text
	parent_id
	created_at
	updated_at
	distance
	url
`;

export const ARTICLE_PRIVACY_OPTIONS: INodePropertyOptions[] = [
	{
		name: 'Private',
		value: 'PRIVATE',
		description: 'Only the subscribers of the article can see it',
	},
	{
		name: 'Public',
		value: 'PUBLIC',
		description: 'Everyone in the workspace can see the article',
	},
];

export const articleObjectIdProperty: INodeProperties = {
	displayName: 'Article ID',
	name: 'articleObjectId',
	type: 'string',
	default: '',
	required: true,
	placeholder: 'e.g. 1234567890',
	description:
		'The object ID of the article. Get it from the output of Create or Get Many, or from the article URL in monday.com.',
};

export function requireArticleId(this: IExecuteFunctions, itemIndex: number): string {
	const raw = String(this.getNodeParameter('articleObjectId', itemIndex, '')).trim();
	if (!/^\d+$/.test(raw)) {
		throw new NodeOperationError(this.getNode(), `Article ID "${raw}" is not a number`, {
			itemIndex,
			description: 'Use the object ID of the article, for example 1234567890.',
		});
	}
	return raw;
}

/**
 * Runs a Knowledge Base request. monday.com gives a bare internal server
 * error when the account has no Knowledge Base, so this explains it.
 */
export async function withArticleErrors<T>(
	context: IExecuteFunctions,
	itemIndex: number,
	request: () => Promise<T>,
): Promise<T> {
	try {
		return await request();
	} catch (error) {
		if (mondayError(error).code === 'INTERNAL_SERVER_ERROR') {
			throw new NodeOperationError(
				context.getNode(),
				'monday.com could not run the Knowledge Base request',
				{
					itemIndex,
					description:
						'monday.com returned an internal server error. Usually the account has no Knowledge Base. Set up the Knowledge Base in monday.com, then run the node again. Also make sure that the article ID is correct.',
				},
			);
		}
		throw error;
	}
}
