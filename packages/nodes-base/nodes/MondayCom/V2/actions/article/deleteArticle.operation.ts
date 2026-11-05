import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { withArchiveOrDeleteOutcome } from '../../helpers/archiveOrDelete';
import {
	ARTICLE_METADATA_FIELDS,
	articleObjectIdProperty,
	requireArticleId,
	withArticleErrors,
} from '../../helpers/articles';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	articleObjectIdProperty,
	{
		displayName: 'Deleting an article cannot be undone with the API',
		name: 'deleteArticleNotice',
		type: 'notice',
		default: '',
	},
];

const displayOptions = {
	show: {
		resource: ['article'],
		operation: ['deleteArticle'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Article: Delete — delete_article. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const objectId = requireArticleId.call(this, itemIndex);
	const data = await withArticleErrors(
		this,
		itemIndex,
		async () =>
			await client.execute(
				`mutation ($objectId: ID!) { delete_article(object_id: $objectId) { ${ARTICLE_METADATA_FIELDS} } }`,
				itemIndex,
				{ objectId },
			),
	);
	const article = (data.delete_article ?? { object_id: objectId }) as IDataObject;
	return withArchiveOrDeleteOutcome(article, 'delete', 'article');
}
