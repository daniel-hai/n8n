import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { KB_SNIPPET_FIELDS, withArticleErrors } from '../../helpers/articles';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	{
		displayName: 'Question',
		name: 'kbSearchQuery',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. How do I create a board?',
		description: 'The question to answer from the knowledge base',
	},
	{
		displayName: 'Options',
		name: 'kbSearchOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [
			{
				displayName: 'Snippet Limit',
				name: 'snippetLimit',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 50 },
				default: 5,
				description: 'Max number of knowledge base snippets to use for the answer',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['article'],
		operation: ['searchKnowledgeBase'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/**
 * Article: Search Knowledge Base — knowledge_base_search. It also uses the
 * monday.com help center, so it works on an account without articles.
 */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const query = String(this.getNodeParameter('kbSearchQuery', itemIndex, '')).trim();
	const options = this.getNodeParameter('kbSearchOptions', itemIndex, {}) as IDataObject;
	if (query === '') {
		throw new NodeOperationError(this.getNode(), 'Question is empty', { itemIndex });
	}

	const data = await withArticleErrors(
		this,
		itemIndex,
		async () =>
			await client.execute(
				`query ($query: String!, $limit: Int) {
				knowledge_base_search(query: $query, limit: $limit) { answer raw_snippets { ${KB_SNIPPET_FIELDS} } }
			}`,
				itemIndex,
				{ query, limit: typeof options.snippetLimit === 'number' ? options.snippetLimit : 5 },
			),
	);
	const result = (data.knowledge_base_search ?? {}) as IDataObject;
	return { query, answer: result.answer ?? null, snippets: result.raw_snippets ?? [] };
}
