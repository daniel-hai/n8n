import {
	type IExecuteFunctions,
	type INodePropertyOptions,
	NodeOperationError,
} from 'n8n-workflow';

/** Throws when an expression gives a value outside the enum. */
export function assertAllowedValue(
	this: IExecuteFunctions,
	value: string,
	options: INodePropertyOptions[],
	fieldName: string,
	itemIndex: number,
): string {
	if (options.some((option) => option.value === value)) return value;
	throw new NodeOperationError(this.getNode(), `${fieldName} "${value}" is not supported`, {
		itemIndex,
		description: `Use one of: ${options.map((option) => String(option.value)).join(', ')}.`,
	});
}

export function requireText(
	this: IExecuteFunctions,
	parameterName: string,
	fieldName: string,
	itemIndex: number,
): string {
	const value = String(this.getNodeParameter(parameterName, itemIndex, '')).trim();
	if (value) return value;
	throw new NodeOperationError(this.getNode(), `${fieldName} is required`, { itemIndex });
}
