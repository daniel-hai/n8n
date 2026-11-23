import {
	type IDataObject,
	type IExecuteFunctions,
	type ILoadOptionsFunctions,
	type INodeProperties,
	type INodePropertyOptions,
	NodeOperationError,
} from 'n8n-workflow';

import { normalizeIdList, parseDateField } from './filterOptions';
import { isPlainJsonObject, safeJsonParse } from './json';
import { mondayError } from './mondayError';
import { MondayGraphQLClient } from '../transport/MondayGraphQLClient';

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
			date: parseDateField.call(this, fields.closeDate, 'Close Date', itemIndex),
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

/** The FormQuestionType enum of the pinned API version. The values mix two cases. */
export const FORM_QUESTION_TYPE_OPTIONS: INodePropertyOptions[] = [
	{ name: 'Boolean (Checkbox)', value: 'Boolean' },
	{ name: 'Connected Boards', value: 'ConnectedBoards' },
	{ name: 'Country', value: 'Country' },
	{ name: 'Date', value: 'Date' },
	{ name: 'Date Range', value: 'DateRange' },
	{ name: 'Display Text', value: 'DISPLAY_TEXT' },
	{ name: 'Email', value: 'Email' },
	{ name: 'File', value: 'File' },
	{ name: 'Hour', value: 'HOUR' },
	{ name: 'Link', value: 'Link' },
	{ name: 'Location', value: 'Location' },
	{ name: 'Long Text', value: 'LongText' },
	{ name: 'Multi Select', value: 'MultiSelect' },
	{ name: 'Name', value: 'Name' },
	{ name: 'Number', value: 'Number' },
	{ name: 'Page Block', value: 'PAGE_BLOCK' },
	{ name: 'People', value: 'People' },
	{ name: 'Phone', value: 'Phone' },
	{ name: 'Rating', value: 'Rating' },
	{ name: 'Short Text', value: 'ShortText' },
	{ name: 'Signature', value: 'Signature' },
	{ name: 'Single Select', value: 'SingleSelect' },
	{ name: 'Subitems', value: 'Subitems' },
	{ name: 'Updates', value: 'Updates' },
];

const QUESTION_TYPES = new Set(FORM_QUESTION_TYPE_OPTIONS.map((option) => String(option.value)));
const CHOICE_QUESTION_TYPES = new Set(['SingleSelect', 'MultiSelect']);

export function assertQuestionType(this: IExecuteFunctions, type: string, itemIndex: number) {
	if (!QUESTION_TYPES.has(type)) {
		throw new NodeOperationError(this.getNode(), `Question Type "${type}" is not supported`, {
			itemIndex,
			description: `Use one of: ${[...QUESTION_TYPES].join(', ')}.`,
		});
	}
}

export interface FormQuestionSummary {
	id: string;
	title: string;
	type: string;
}

function toQuestionSummaries(form: unknown): FormQuestionSummary[] {
	if (!isPlainJsonObject(form) || !Array.isArray(form.questions)) return [];
	return form.questions.filter(isPlainJsonObject).map((question) => ({
		id: String(question.id),
		title: typeof question.title === 'string' ? question.title : '',
		type: typeof question.type === 'string' ? question.type : '',
	}));
}

export async function readFormQuestions(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
	formToken: string,
): Promise<FormQuestionSummary[]> {
	const data = await executeFormRequest.call(
		this,
		client,
		itemIndex,
		formToken,
		'query ($formToken: String!) { form(formToken: $formToken) { questions { id title type } } }',
		{ formToken },
	);
	return toQuestionSummaries(data.form);
}

export function questionNotFoundError(
	this: IExecuteFunctions,
	questionId: string,
	formToken: string,
	questions: FormQuestionSummary[],
	itemIndex: number,
): NodeOperationError {
	return new NodeOperationError(
		this.getNode(),
		`Question ${questionId} was not found on form ${formToken}`,
		{
			itemIndex,
			description: `The form has these question IDs: ${questions.map((q) => q.id).join(', ')}.`,
		},
	);
}

/**
 * Builds the shared fields of CreateQuestionInput and UpdateQuestionInput.
 * monday.com rejects choices on other types with only "options is not allowed".
 */
export function buildQuestionFields(
	this: IExecuteFunctions,
	type: string,
	fields: IDataObject,
	itemIndex: number,
): IDataObject {
	const question: IDataObject = {};
	if (typeof fields.title === 'string' && fields.title.trim() !== '') {
		question.title = fields.title.trim();
	}
	if (typeof fields.description === 'string' && fields.description !== '') {
		question.description = fields.description;
	}
	if (typeof fields.required === 'boolean') question.required = fields.required;
	if (typeof fields.visible === 'boolean') question.visible = fields.visible;

	const choices = normalizeIdList(fields.optionLabels);
	if (choices.length > 0) {
		if (!CHOICE_QUESTION_TYPES.has(type)) {
			throw new NodeOperationError(
				this.getNode(),
				'Choices work only with Single Select and Multi Select questions',
				{ itemIndex, description: `The question type is ${type}.` },
			);
		}
		question.options = choices.map((label) => ({ label }));
	}

	const settings = parseJsonObjectOption.call(
		this,
		fields.settingsJson,
		'Settings (JSON)',
		itemIndex,
	);
	if (settings && Object.keys(settings).length > 0) question.settings = settings;
	return question;
}

function formTokenFromLoadOptions(context: ILoadOptionsFunctions): string | null {
	return extractFormToken(context.getCurrentNodeParameter('formToken'));
}

export async function getFormQuestionsList(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const formToken = formTokenFromLoadOptions(this);
	if (!formToken) return [];
	const data = await new MondayGraphQLClient(this).execute(
		'query ($formToken: String!) { form(formToken: $formToken) { questions { id title type } } }',
		0,
		{ formToken },
	);
	return toQuestionSummaries(data.form).map((question) => ({
		name: `${question.title || question.id} (${question.type || 'unknown type'})`,
		value: question.id,
	}));
}

export async function getFormTagsList(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const formToken = formTokenFromLoadOptions(this);
	if (!formToken) return [];
	const data = await new MondayGraphQLClient(this).execute(
		'query ($formToken: String!) { form(formToken: $formToken) { tags { id name } } }',
		0,
		{ formToken },
	);
	const form = isPlainJsonObject(data.form) ? data.form : {};
	const tags = Array.isArray(form.tags) ? form.tags.filter(isPlainJsonObject) : [];
	return tags.map((tag) => ({
		name: typeof tag.name === 'string' && tag.name !== '' ? tag.name : String(tag.id),
		value: String(tag.id),
	}));
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
