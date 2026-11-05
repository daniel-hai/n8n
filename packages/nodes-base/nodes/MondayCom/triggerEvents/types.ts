import type { IHookFunctions, IWebhookFunctions, IWebhookResponseData } from 'n8n-workflow';

/**
 * One event of the Monday.com Trigger. The node picks the handler that matches
 * its `event` parameter. To add an event, add a handler file and register it in
 * `MondayComTrigger.node.ts`.
 */
export interface MondayTriggerEvent {
	checkExists(this: IHookFunctions): Promise<boolean>;
	create(this: IHookFunctions): Promise<boolean>;
	delete(this: IHookFunctions): Promise<boolean>;
	webhook(this: IWebhookFunctions): Promise<IWebhookResponseData>;
}
