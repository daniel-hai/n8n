import type {
	IWebhookData,
	INode,
	IWorkflowDataProxyAdditionalKeys,
	Workflow,
	WorkflowExecuteMode,
	IExecuteData,
	IWebhookDescription,
	NodeParameterValueType,
} from 'n8n-workflow';
import { resolveWebhookDescriptionField } from 'n8n-workflow';

/**
 * A helper class that holds the context for the webhook execution.
 * Provides quality of life methods for evaluating expressions.
 */
export class WebhookExecutionContext {
	constructor(
		readonly workflow: Workflow,
		readonly workflowStartNode: INode,
		readonly webhookData: IWebhookData,
		readonly executionMode: WorkflowExecuteMode,
		readonly additionalKeys: IWorkflowDataProxyAdditionalKeys,
	) {}

	/**
	 * Evaluates a simple expression from the webhook description.
	 */
	evaluateSimpleWebhookDescriptionExpression<T extends boolean | number | string | unknown[]>(
		propertyName: keyof IWebhookDescription,
		executeData?: IExecuteData,
		defaultValue?: T,
	): T | undefined {
		// The symbol key holds the resolver map, never an evaluable value.
		if (typeof propertyName !== 'string') return defaultValue;

		const native = this.resolveNatively(propertyName);
		if (native.resolved) return native.value as T | undefined;

		return this.workflow.expression.getSimpleParameterValue(
			this.workflowStartNode,
			this.webhookData.webhookDescription[propertyName],
			this.executionMode,
			this.additionalKeys,
			executeData,
			defaultValue,
		) as T | undefined;
	}

	/**
	 * Evaluates a complex expression from the webhook description.
	 */
	evaluateComplexWebhookDescriptionExpression<T extends NodeParameterValueType>(
		propertyName: keyof IWebhookDescription,
		executeData?: IExecuteData,
		defaultValue?: T,
	): T | undefined {
		// The symbol key holds the resolver map, never an evaluable value.
		if (typeof propertyName !== 'string') return defaultValue;

		const native = this.resolveNatively(propertyName);
		if (native.resolved) return native.value as T | undefined;

		return this.workflow.expression.getComplexParameterValue(
			this.workflowStartNode,
			this.webhookData.webhookDescription[propertyName],
			this.executionMode,
			this.additionalKeys,
			executeData,
			defaultValue,
		) as T | undefined;
	}

	/**
	 * Resolves a description field without the expression engine when the field
	 * declares a native resolver and the node's parameters are static — see
	 * `webhookDescriptionFields` in n8n-workflow. Like the engine path, the
	 * resolved value is returned as-is: `defaultValue` only stands in for a
	 * field the description does not define at all.
	 */
	private resolveNatively(propertyName: string) {
		return resolveWebhookDescriptionField(
			this.workflowStartNode,
			this.webhookData.webhookDescription,
			propertyName,
		);
	}
}
