import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import {
	executeFormRequest,
	FORM_FIELDS,
	formTokenProperty,
	formUrl,
	requireFormToken,
} from '../../helpers/forms';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [formTokenProperty];

const displayOptions = {
	show: {
		resource: ['form'],
		operation: ['getForm'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Form: Get — the settings, appearance, questions and tags of one form. */
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
		`query ($formToken: String!) { form(formToken: $formToken) { ${FORM_FIELDS} } }`,
		{ formToken },
	);
	return { ...((data.form ?? {}) as IDataObject), formUrl: formUrl(formToken) };
}
