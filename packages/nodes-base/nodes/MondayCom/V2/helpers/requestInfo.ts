import type { IDataObject, ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { MondayGraphQLClient, type MondayRequestInfo } from '../transport/MondayGraphQLClient';

/** monday API versions have the form yyyy-mm. */
export const API_VERSION_PATTERN = /^\d{4}-\d{2}$/;

/**
 * The output of Get Rate Limits and of the Include Request Info option.
 * All values come from the response headers, so the complexity budget
 * needs no `complexity` query.
 */
export function buildRequestInfoOutput(
	requestInfo: MondayRequestInfo,
	requestedApiVersion: string,
): IDataObject {
	return {
		rateLimit: requestInfo.rateLimit ?? null,
		rateLimitPolicy: requestInfo.rateLimitPolicy ?? null,
		apiVersionRequested: requestedApiVersion,
		apiVersionReturned: requestInfo.apiVersion ?? null,
		requestId: requestInfo.requestId ?? null,
		statusCode: requestInfo.statusCode ?? null,
	};
}

interface VersionRow {
	kind: string;
	value: string;
	display_name: string;
}

/**
 * API version picker for GraphQL: Execute Query. Newest first, labeled with
 * the lifecycle. The unstable "dev" version is left out.
 */
export async function getApiVersions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const client = new MondayGraphQLClient(this);
	const data = await client.execute('query { versions { kind value display_name } }', 0);
	return ((data.versions ?? []) as VersionRow[])
		.filter((version) => version.kind !== 'dev')
		.sort((a, b) => b.value.localeCompare(a.value))
		.map((version) => ({
			name: `${version.value} (${version.display_name})`,
			value: version.value,
		}));
}
