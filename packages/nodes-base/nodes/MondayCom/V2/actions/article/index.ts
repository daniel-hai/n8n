import type { INodeProperties } from 'n8n-workflow';

import * as createArticle from './createArticle.operation';
import * as deleteArticle from './deleteArticle.operation';
import * as getArticleBlocks from './getArticleBlocks.operation';
import * as getArticles from './getArticles.operation';
import * as publishArticle from './publishArticle.operation';
import * as searchKnowledgeBase from './searchKnowledgeBase.operation';

export {
	createArticle,
	deleteArticle,
	getArticleBlocks,
	getArticles,
	publishArticle,
	searchKnowledgeBase,
};

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['article'] } },
		options: [
			{
				name: 'Create',
				value: 'createArticle',
				action: 'Create an article',
				description: 'Create a draft article in a workspace. The account needs a Knowledge Base.',
			},
			{
				name: 'Delete',
				value: 'deleteArticle',
				action: 'Delete an article',
				description: 'Delete an article permanently',
			},
			{
				name: 'Get Blocks',
				value: 'getArticleBlocks',
				action: 'Get article blocks',
				description:
					'Return the content blocks of a published article, one output item for each block',
			},
			{
				name: 'Get Many',
				value: 'getArticles',
				action: 'Get many articles',
				description: 'Return published articles by their IDs',
			},
			{
				name: 'Publish',
				value: 'publishArticle',
				action: 'Publish an article',
				description: 'Publish a draft article and set who can see it',
			},
			{
				name: 'Search Knowledge Base',
				value: 'searchKnowledgeBase',
				action: 'Search the knowledge base',
				description: 'Answer a question from the knowledge base, with the source snippets',
			},
		],
		default: 'searchKnowledgeBase',
	},
	...createArticle.description,
	...deleteArticle.description,
	...getArticleBlocks.description,
	...getArticles.description,
	...publishArticle.description,
	...searchKnowledgeBase.description,
];
