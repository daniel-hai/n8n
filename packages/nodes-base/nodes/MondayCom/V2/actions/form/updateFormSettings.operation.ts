import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import {
	buildFormSettingsInput,
	executeFormRequest,
	formTokenProperty,
	parseJsonObjectOption,
	requireFormToken,
} from '../../helpers/forms';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const properties: INodeProperties[] = [
	formTokenProperty,
	{
		displayName: 'Settings',
		name: 'formSettingsFields',
		type: 'collection',
		placeholder: 'Add setting',
		default: {},
		options: [
			{
				displayName: 'Allow Draft Submissions',
				name: 'allowDraftSubmissions',
				type: 'boolean',
				default: false,
				description: 'Whether responders can save a response that is not complete',
			},
			{
				displayName: 'Anonymous Responses',
				name: 'anonymousResponses',
				type: 'boolean',
				default: false,
				description: 'Whether the form collects responses without the name of the responder',
			},
			{
				displayName: 'Close Date',
				name: 'closeDate',
				type: 'dateTime',
				default: '',
				description:
					'When the form stops to accept responses. The node reads the date in the workflow timezone.',
			},
			{
				displayName: 'Hide monday.com Branding',
				name: 'hideBranding',
				type: 'boolean',
				default: false,
				description: 'Whether the form hides the monday.com branding',
			},
			{
				displayName: 'Language',
				name: 'language',
				type: 'string',
				default: '',
				placeholder: 'e.g. en',
				description: 'The language code for the interface text of the form',
			},
			{
				displayName: 'Primary Color',
				name: 'primaryColor',
				type: 'color',
				default: '',
				description: 'The main theme color of the form, as a HEX value',
			},
			{
				displayName: 'Raw Settings (JSON)',
				name: 'rawSettings',
				type: 'json',
				default: '',
				description:
					'An UpdateFormSettingsInput object for settings without a field here, for example logo, background or layout. Its values replace the values of the other fields. See the <a href="https://developer.monday.com/api-reference/reference/forms-other-types#updateformsettingsinput">monday.com docs</a>.',
			},
			{
				displayName: 'Redirect URL After Submission',
				name: 'redirectUrlAfterSubmission',
				type: 'string',
				default: '',
				description: 'The URL to send responders to after they submit the form',
			},
			{
				displayName: 'Remove Close Date',
				name: 'removeCloseDate',
				type: 'boolean',
				default: false,
				description: 'Whether to remove the close date. This setting ignores Close Date.',
			},
			{
				displayName: 'Require CAPTCHA',
				name: 'reCaptcha',
				type: 'boolean',
				default: false,
				description: 'Whether responders must pass a reCAPTCHA check',
			},
			{
				displayName: 'Require Login',
				name: 'requireLogin',
				type: 'boolean',
				default: false,
				description: 'Whether responders must log in to monday.com before they submit',
			},
			{
				displayName: 'Response Limit',
				name: 'responseLimit',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 0,
				description: 'The maximum number of responses. Set 0 to remove the limit.',
			},
			{
				displayName: 'Show Progress Bar',
				name: 'showProgressBar',
				type: 'boolean',
				default: false,
				description: 'Whether the form shows how much of it the responder completed',
			},
			{
				displayName: 'Submit Button Text',
				name: 'submitButtonText',
				type: 'string',
				default: '',
				description: 'The text on the submit button',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['form'],
		operation: ['updateFormSettings'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Form: Update Settings — update_form_settings for features, appearance and accessibility. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const formToken = requireFormToken.call(this, itemIndex);
	const { rawSettings, ...fields } = this.getNodeParameter(
		'formSettingsFields',
		itemIndex,
		{},
	) as IDataObject;
	const raw = parseJsonObjectOption.call(this, rawSettings, 'Raw Settings (JSON)', itemIndex);
	const settings = buildFormSettingsInput.call(this, fields, raw, itemIndex);

	const data = await executeFormRequest.call(
		this,
		client,
		itemIndex,
		formToken,
		`mutation ($formToken: String!, $settings: UpdateFormSettingsInput!) {
			update_form_settings(formToken: $formToken, settings: $settings) {
				id
				token
				title
				active
				isAnonymous
				accessibility { language logoAltText }
				appearance { primaryColor showProgressBar hideBranding submitButton { text } }
				features {
					reCaptchaChallenge
					password { enabled }
					requireLogin { enabled redirectToLogin }
					responseLimit { enabled limit }
					draftSubmission { enabled }
					closeDate { enabled date }
					afterSubmissionView { redirectAfterSubmission { enabled redirectUrl } }
				}
			}
		}`,
		{ formToken, settings },
	);
	return (data.update_form_settings ?? {}) as IDataObject;
}
