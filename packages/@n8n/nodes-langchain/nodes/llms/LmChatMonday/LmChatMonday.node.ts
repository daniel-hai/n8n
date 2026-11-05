import { ChatOpenAI, type ClientOptions } from '@langchain/openai';
import {
	getProxyAgent,
	aiClientFetch,
	makeN8nLlmFailedAttemptHandler,
	N8nLlmTracing,
	getConnectionHintNoticeField,
} from '@n8n/ai-utilities';
import {
	NodeConnectionTypes,
	type INodeType,
	type INodeTypeDescription,
	type ISupplyDataFunctions,
	type SupplyData,
} from 'n8n-workflow';

import { openAiFailedAttemptHandler } from '../../vendors/OpenAi/helpers/error-handling';

/** monday Models API. OpenAI-compatible chat completions. */
const MONDAY_MODELS_BASE_URL = 'https://api.monday.com/platform-ai-gateway/openai/v1';

/**
 * Chat models for `/chat/completions`. The aliases come first. monday maps each
 * alias to a current model. The other entries are fixed vendor IDs from the
 * supported models list.
 */
const MONDAY_ALIAS_MODELS = [
	{
		name: 'Fast',
		value: 'monday-fast',
		description: 'Lower latency. Alias for a smaller model.',
	},
	{
		name: 'Powerful',
		value: 'monday-powerful',
		description: 'Higher quality. Alias for a larger model.',
	},
	{
		name: 'Standard',
		value: 'monday-standard',
		description: 'Default balance of quality and speed',
	},
];

function vendorModel(name: string, value: string, vendor: 'Anthropic' | 'OpenAI') {
	return { name, value, description: `${vendor}: ${value}` };
}

const MONDAY_CHAT_MODELS = [
	...MONDAY_ALIAS_MODELS,
	vendorModel('Claude 3 Haiku', 'claude-3-haiku', 'Anthropic'),
	vendorModel('Claude 3.5 Sonnet', 'claude-3-5-sonnet', 'Anthropic'),
	vendorModel('Claude 3.7 Sonnet', 'claude-3-7-sonnet', 'Anthropic'),
	vendorModel('Claude Fable 5', 'claude-fable-5', 'Anthropic'),
	vendorModel('Claude Haiku 4.5', 'claude-haiku-4-5', 'Anthropic'),
	vendorModel('Claude Haiku 5.5', 'claude-haiku-5-5', 'Anthropic'),
	vendorModel('Claude Opus 4.5', 'claude-opus-4-5', 'Anthropic'),
	vendorModel('Claude Opus 4.6', 'claude-opus-4-6', 'Anthropic'),
	vendorModel('Claude Opus 4.7', 'claude-opus-4-7', 'Anthropic'),
	vendorModel('Claude Opus 4.8', 'claude-opus-4-8', 'Anthropic'),
	vendorModel('Claude Opus 5', 'claude-opus-5', 'Anthropic'),
	vendorModel('Claude Opus 5.5', 'claude-opus-5-5', 'Anthropic'),
	vendorModel('Claude Sonnet 4', 'claude-sonnet-4', 'Anthropic'),
	vendorModel('Claude Sonnet 4.5', 'claude-sonnet-4-5', 'Anthropic'),
	vendorModel('Claude Sonnet 4.6', 'claude-sonnet-4-6', 'Anthropic'),
	vendorModel('Claude Sonnet 5', 'claude-sonnet-5', 'Anthropic'),
	vendorModel('Claude Sonnet 5.5', 'claude-sonnet-5-5', 'Anthropic'),
	vendorModel('GPT 4.1', 'gpt-4.1', 'OpenAI'),
	vendorModel('GPT 4.1 Mini', 'gpt-4.1-mini', 'OpenAI'),
	vendorModel('GPT 4.1 Nano', 'gpt-4.1-nano', 'OpenAI'),
	vendorModel('GPT 4o', 'gpt-4o', 'OpenAI'),
	vendorModel('GPT 4o Mini', 'gpt-4o-mini', 'OpenAI'),
	vendorModel('GPT 5', 'gpt-5', 'OpenAI'),
	vendorModel('GPT 5 Mini', 'gpt-5-mini', 'OpenAI'),
	vendorModel('GPT 5 Nano', 'gpt-5-nano', 'OpenAI'),
	vendorModel('GPT 5.6 Luna', 'gpt-5.6-luna', 'OpenAI'),
	vendorModel('GPT 5.6 Sol', 'gpt-5.6-sol', 'OpenAI'),
	vendorModel('GPT 6 Astra', 'gpt-6-astra', 'OpenAI'),
	vendorModel('GPT 6 Luna', 'gpt-6-luna', 'OpenAI'),
	vendorModel('GPT 6.1 Sol', 'gpt-6.1-sol', 'OpenAI'),
];

type MondayApiCredential = {
	apiToken: string;
};

type MondayModelOptions = {
	maxRetries?: number;
	maxTokens?: number;
	responseFormat?: 'text' | 'json_object';
	temperature?: number;
	timeout?: number;
	topP?: number;
};

export class LmChatMonday implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Monday.com Chat Model',
		name: 'lmChatMonday',
		icon: { light: 'file:mondayCom.svg', dark: 'file:mondayCom.dark.svg' },
		group: ['transform'],
		version: [1],
		description: 'Chat model through the monday.com Models API',
		defaults: {
			name: 'Monday.com Chat Model',
		},
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Language Models', 'Root Nodes'],
				'Language Models': ['Chat Models (Recommended)'],
			},
			resources: {
				primaryDocumentation: [
					{
						url: 'https://developer.monday.com/api-reference/docs/getting-started-with-the-models-api',
					},
				],
			},
		},
		inputs: [],
		outputs: [NodeConnectionTypes.AiLanguageModel],
		outputNames: ['Model'],
		credentials: [
			{
				name: 'mondayComApi',
				required: true,
			},
		],
		requestDefaults: {
			ignoreHttpStatusErrors: true,
			baseURL: MONDAY_MODELS_BASE_URL,
		},
		properties: [
			getConnectionHintNoticeField([NodeConnectionTypes.AiChain, NodeConnectionTypes.AiAgent]),
			{
				displayName:
					'Uses your Monday.com API token. Calls go to the Models API and consume monday AI tokens. Connect this node to an AI Agent or a Basic LLM Chain.',
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'If using JSON response format, include the word "json" in the prompt.',
				name: 'jsonNotice',
				type: 'notice',
				default: '',
				displayOptions: {
					show: {
						'/options.responseFormat': ['json_object'],
					},
				},
			},
			{
				displayName: 'Model',
				name: 'model',
				type: 'options',
				description:
					'The chat model. Aliases stay stable when monday.com changes the underlying model. A specific model stays fixed. <a href="https://developer.monday.com/api-reference/docs/models-api-supported-models">Supported models</a>.',
				options: MONDAY_CHAT_MODELS,
				default: 'monday-standard',
			},
			{
				displayName: 'Options',
				name: 'options',
				placeholder: 'Add Option',
				description: 'Additional options to add',
				type: 'collection',
				default: {},
				options: [
					{
						displayName: 'Maximum Number of Tokens',
						name: 'maxTokens',
						default: -1,
						description: 'The maximum number of tokens to generate. Use -1 for the model maximum.',
						type: 'number',
						typeOptions: {
							maxValue: 32768,
						},
					},
					{
						displayName: 'Response Format',
						name: 'responseFormat',
						default: 'text',
						type: 'options',
						options: [
							{
								name: 'Text',
								value: 'text',
								description: 'Regular text response',
							},
							{
								name: 'JSON',
								value: 'json_object',
								description: 'Ask the model to return a JSON object',
							},
						],
					},
					{
						displayName: 'Sampling Temperature',
						name: 'temperature',
						default: 0.7,
						typeOptions: { maxValue: 2, minValue: 0, numberPrecision: 1 },
						description:
							'Controls randomness. Lower values make the completion more deterministic.',
						type: 'number',
					},
					{
						displayName: 'Timeout',
						name: 'timeout',
						default: 360000,
						description: 'Maximum amount of time a request is allowed to take in milliseconds',
						type: 'number',
					},
					{
						displayName: 'Max Retries',
						name: 'maxRetries',
						default: 2,
						description: 'Maximum number of retries to attempt',
						type: 'number',
					},
					{
						displayName: 'Top P',
						name: 'topP',
						default: 1,
						typeOptions: { maxValue: 1, minValue: 0, numberPrecision: 1 },
						description:
							'Controls diversity via nucleus sampling. Change this or temperature, not both.',
						type: 'number',
					},
				],
			},
		],
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const credentials = await this.getCredentials<MondayApiCredential>('mondayComApi');
		const modelName = this.getNodeParameter('model', itemIndex) as string;
		const options = this.getNodeParameter('options', itemIndex, {}) as MondayModelOptions;
		const timeout = options.timeout;

		const configuration: ClientOptions = {
			baseURL: MONDAY_MODELS_BASE_URL,
			fetch: aiClientFetch,
			fetchOptions: {
				dispatcher: getProxyAgent(
					MONDAY_MODELS_BASE_URL,
					{
						headersTimeout: timeout,
						bodyTimeout: timeout,
					},
					this.helpers.getSecureEgressFilter(),
				),
			},
		};

		const model = new ChatOpenAI({
			apiKey: credentials.apiToken,
			model: modelName,
			...options,
			timeout,
			maxRetries: options.maxRetries ?? 2,
			configuration,
			callbacks: [new N8nLlmTracing(this)],
			modelKwargs:
				options.responseFormat && options.responseFormat !== 'text'
					? {
							response_format: { type: options.responseFormat },
						}
					: undefined,
			onFailedAttempt: makeN8nLlmFailedAttemptHandler(this, openAiFailedAttemptHandler),
		});

		return {
			response: model,
		};
	}
}
