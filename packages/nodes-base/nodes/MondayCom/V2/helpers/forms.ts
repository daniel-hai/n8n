import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	type INodePropertyOptions,
	NodeApiError,
	NodeOperationError,
	tryToParseDateTime,
} from 'n8n-workflow';

import { isPlainJsonObject, safeJsonParse } from './json';
import type { MondayGraphQLClient } from '../transport/MondayGraphQLClient';

/**
 * monday.com WorkForms. The API reads and changes a form only by its token.
 * No query lists forms, so the node cannot offer a form picker.
 */

export const FORM_PUBLIC_URL_BASE = 'https://forms.monday.com/forms/';

export const FORM_BOARD_KIND_OPTIONS: INodePropertyOptions[] = [
	{ name: 'Private', value: 'private' },
	{ name: 'Public', value: 'public' },
	{ name: 'Shareable', value: 'share' },
];

export const FORM_QUESTION_FIELDS = `
	id
	title
	type
	required
	visible
	description
	options { label }
	settings {
		checkedByDefault
		defaultCurrentDate
		display
		includeTime
		limit
		locationAutofilled
		optionsOrder
		prefixAutofilled
		prefill { enabled lookup source }
		prefixPredefined { enabled prefix }
		skipValidation
		label_limit_count_enabled
		default_answer
	}
	show_if_rules
`;

// The live schema spells the field builtWithAI. The docs spell it builtWithAi.
export const FORM_FIELDS = `
	id
	token
	title
	description
	active
	isAnonymous
	ownerId
	type
	builtWithAI
	accessibility { language logoAltText }
	appearance {
		primaryColor
		showProgressBar
		hideBranding
		background { type value }
		layout { alignment direction }
		logo { position size url }
		submitButton { text }
		text { color font size }
	}
	features {
		isInternal
		reCaptchaChallenge
		password { enabled }
		requireLogin { enabled redirectToLogin }
		responseLimit { enabled limit }
		shortenedLink { enabled url }
		draftSubmission { enabled }
		closeDate { enabled date }
		preSubmissionView { enabled title description startButton { text } }
		afterSubmissionView {
			title
			description
			allowResubmit
			allowViewSubmission
			allowEditSubmission
			showSuccessImage
			redirectAfterSubmission { enabled redirectUrl }
		}
		monday { includeNameQuestion includeUpdateQuestion itemGroupId syncQuestionAndColumnsTitles }
	}
	questions { ${FORM_QUESTION_FIELDS} }
	tags { id name columnId }
`;

// The token is part of the public form URL. It is not a secret.
export const formTokenProperty: INodeProperties = {
	displayName: 'Form Token',
	name: 'formToken',
	// eslint-disable-next-line n8n-nodes-base/node-param-type-options-password-missing
	type: 'string',
	default: '',
	required: true,
	placeholder: 'e.g. 4e03ad5c19a193b2973a9aecee176552',
	description:
		'The token of the form, or the full form URL. The token is the part after /forms/ in the URL. A short wkf.ms link does not contain the token.',
};

/**
 * Returns the token from a raw token or a full form URL, or null.
 * A short wkf.ms link does not contain the token.
 */
export function extractFormToken(input: unknown): string | null {
	const trimmed = typeof input === 'string' ? input.trim() : '';
	if (trimmed === '' || /(^|\/\/)wkf\.ms\//i.test(trimmed)) return null;

	const urlMatch = trimmed.match(/forms\.monday\.com\/forms\/([a-z0-9]+)/i);
	if (urlMatch) return urlMatch[1];
	return /^[a-z0-9]+$/i.test(trimmed) ? trimmed : null;
}

export function requireFormToken(this: IExecuteFunctions, itemIndex: number): string {
	const raw = this.getNodeParameter('formToken', itemIndex, '');
	const token = extractFormToken(raw);
	if (!token) {
		throw new NodeOperationError(this.getNode(), 'Form Token is not a form token or form URL', {
			itemIndex,
			description: `Received "${String(raw)}". Use the token after /forms/ in https://forms.monday.com/forms/<token>. A short wkf.ms link does not contain the token. Open the link in a browser and copy the full URL.`,
		});
	}
	return token;
}

export function formUrl(token: string): string {
	return `${FORM_PUBLIC_URL_BASE}${token}`;
}

/** The raw monday.com error that the client keeps on a NodeApiError. */
export function mondayError(error: unknown): { code?: string; message: string } {
	if (!(error instanceof NodeApiError) || !isPlainJsonObject(error.errorResponse)) {
		return { message: error instanceof Error ? error.message : String(error) };
	}
	const raw = error.errorResponse;
	const extensions = isPlainJsonObject(raw.extensions) ? raw.extensions : {};
	const code = extensions.code ?? raw.error_code;
	return {
		code: typeof code === 'string' ? code : undefined,
		message: typeof raw.message === 'string' ? raw.message : error.message,
	};
}

/**
 * Runs a form request. The monday.com messages for a bad, unknown, deleted
 * or deactivated form do not tell the user what to do, so this replaces them.
 */
export async function executeFormRequest(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
	formToken: string,
	query: string,
	variables: IDataObject,
): Promise<IDataObject> {
	try {
		return await client.execute(query, itemIndex, variables);
	} catch (error) {
		const { code, message } = mondayError(error);
		if (code === 'InvalidFormToken') {
			throw new NodeOperationError(this.getNode(), `Form Token "${formToken}" is not valid`, {
				itemIndex,
				description: `monday.com: ${message} Use the token after /forms/ in the form URL.`,
			});
		}
		if (code === 'USER_UNAUTHORIZED') {
			throw new NodeOperationError(
				this.getNode(),
				`Form ${formToken} was not found, or you have no access to it`,
				{
					itemIndex,
					description:
						'monday.com gives this error for an unknown token and for a form on a board that you cannot access. Check the token and your access to the response board.',
				},
			);
		}
		if (code === 'FormDeleted') {
			throw new NodeOperationError(this.getNode(), `Form ${formToken} was not found`, {
				itemIndex,
				description: `monday.com: ${message} A form is deleted with its response board.`,
			});
		}
		if (code === 'DeactivatedForm') {
			throw new NodeOperationError(this.getNode(), `Form ${formToken} is deactivated`, {
				itemIndex,
				description:
					'monday.com blocks all operations on a deactivated form, also Get. Use Activate or Deactivate with the Activate action first.',
			});
		}
		throw error;
	}
}

/** Parses an optional JSON object field. A string must contain a JSON object. */
export function parseJsonObjectOption(
	this: IExecuteFunctions,
	value: unknown,
	fieldName: string,
	itemIndex: number,
): IDataObject | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	const parsed = typeof value === 'string' ? safeJsonParse(value) : value;
	if (isPlainJsonObject(parsed)) return parsed;
	throw new NodeOperationError(this.getNode(), `${fieldName} is not a JSON object`, {
		itemIndex,
		description: `Received ${typeof value === 'string' ? `"${value}"` : JSON.stringify(value)}.`,
	});
}

/** Merges `override` into `base`. Nested objects merge. Other values replace. */
export function deepMergeObjects(base: IDataObject, override: IDataObject): IDataObject {
	const result: IDataObject = { ...base };
	for (const [key, value] of Object.entries(override)) {
		const existing = result[key];
		result[key] =
			isPlainJsonObject(value) && isPlainJsonObject(existing)
				? deepMergeObjects(existing, value)
				: value;
	}
	return result;
}

function parseCloseDate(this: IExecuteFunctions, value: unknown, itemIndex: number): string {
	let iso: string | null = null;
	try {
		iso = tryToParseDateTime(value, this.getTimezone()).toUTC().toISO();
	} catch {
		iso = null;
	}
	if (iso) return iso;
	throw new NodeOperationError(this.getNode(), 'Close Date is not a valid date', {
		itemIndex,
		description: `Received "${String(value)}". Use an ISO 8601 date, for example 2026-01-31T09:00:00.`,
	});
}

/**
 * Builds UpdateFormSettingsInput from the typed fields. Raw Settings merges
 * last and wins. is_anonymous is top level on the pinned API version.
 */
export function buildFormSettingsInput(
	this: IExecuteFunctions,
	fields: IDataObject,
	rawSettings: IDataObject | undefined,
	itemIndex: number,
): IDataObject {
	const settings: IDataObject = {};
	const appearance: IDataObject = {};
	const features: IDataObject = {};
	const accessibility: IDataObject = {};

	if (typeof fields.anonymousResponses === 'boolean') {
		settings.is_anonymous = fields.anonymousResponses;
	}
	if (typeof fields.language === 'string' && fields.language !== '') {
		accessibility.language = fields.language;
	}
	if (typeof fields.primaryColor === 'string' && fields.primaryColor !== '') {
		appearance.primaryColor = fields.primaryColor;
	}
	if (typeof fields.showProgressBar === 'boolean') {
		appearance.showProgressBar = fields.showProgressBar;
	}
	if (typeof fields.hideBranding === 'boolean') {
		appearance.hideBranding = fields.hideBranding;
	}
	if (typeof fields.submitButtonText === 'string' && fields.submitButtonText !== '') {
		appearance.submitButton = { text: fields.submitButtonText };
	}
	if (typeof fields.requireLogin === 'boolean') {
		features.requireLogin = { enabled: fields.requireLogin };
	}
	if (typeof fields.reCaptcha === 'boolean') {
		features.reCaptchaChallenge = fields.reCaptcha;
	}
	if (fields.responseLimit !== undefined && fields.responseLimit !== '') {
		const limit = Number(fields.responseLimit);
		if (!Number.isInteger(limit) || limit < 0) {
			throw new NodeOperationError(this.getNode(), 'Response Limit is not a whole number', {
				itemIndex,
				description: `Received "${String(fields.responseLimit)}". Use 0 or more. 0 removes the limit.`,
			});
		}
		features.responseLimit = limit === 0 ? { enabled: false } : { enabled: true, limit };
	}
	if (typeof fields.allowDraftSubmissions === 'boolean') {
		features.draftSubmission = { enabled: fields.allowDraftSubmissions };
	}
	if (fields.removeCloseDate === true) {
		features.closeDate = { enabled: false };
	} else if (fields.closeDate !== undefined && fields.closeDate !== '') {
		features.closeDate = {
			enabled: true,
			date: parseCloseDate.call(this, fields.closeDate, itemIndex),
		};
	}
	if (
		typeof fields.redirectUrlAfterSubmission === 'string' &&
		fields.redirectUrlAfterSubmission !== ''
	) {
		features.afterSubmissionView = {
			redirectAfterSubmission: { enabled: true, redirectUrl: fields.redirectUrlAfterSubmission },
		};
	}

	if (Object.keys(appearance).length > 0) settings.appearance = appearance;
	if (Object.keys(features).length > 0) settings.features = features;
	if (Object.keys(accessibility).length > 0) settings.accessibility = accessibility;

	const merged = rawSettings ? deepMergeObjects(settings, rawSettings) : settings;
	if (Object.keys(merged).length === 0) {
		throw new NodeOperationError(this.getNode(), 'Add at least one setting to update', {
			itemIndex,
		});
	}
	return merged;
}

/** Throws when monday.com answers a Boolean form mutation with something other than true. */
export function assertFormMutationSucceeded(
	this: IExecuteFunctions,
	result: unknown,
	action: string,
	itemIndex: number,
): void {
	if (result !== true) {
		throw new NodeOperationError(this.getNode(), `monday.com could not ${action}`, {
			itemIndex,
			description: `monday.com returned ${JSON.stringify(result ?? null)} instead of true.`,
		});
	}
}
