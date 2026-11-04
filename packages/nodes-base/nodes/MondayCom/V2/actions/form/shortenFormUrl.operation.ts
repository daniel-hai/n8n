import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import {
	executeFormRequest,
	formTokenProperty,
	formUrl,
	requireFormToken,
} from '../../helpers/forms';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [formTokenProperty];

const displayOptions = {
	show: {
		resource: ['form'],
		operation: ['shortenFormUrl'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Form: Shorten URL — shorten_form_url. A second call returns the same short link. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const formToken = requireFormToken.call(this, itemIndex);
	const data = await executeFormRequest.call(
		this,
		client,
		itemIndex,
		formToken,
		'mutation ($formToken: String!) { shorten_form_url(formToken: $formToken) { enabled url } }',
		{ formToken },
	);
	const link = (data.shorten_form_url ?? {}) as IDataObject;
	return { token: formToken, formUrl: formUrl(formToken), ...link };
}
