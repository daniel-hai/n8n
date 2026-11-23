import { NodeApiError } from 'n8n-workflow';

import { isPlainJsonObject } from './json';

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
