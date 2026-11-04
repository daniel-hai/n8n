import {
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import { FORM_BOARD_KIND_OPTIONS, formUrl, mondayError } from '../../helpers/forms';
import {
	buildUserRowsProperty,
	extractUserRowIds,
	splitUserTeamIds,
} from '../../helpers/userLocator';
import { workspaceResourceLocator } from '../../helpers/workspaceLocator';
import type { MondayGraphQLClient } from '../../transport/MondayGraphQLClient';

const BOARD_KINDS = new Set(FORM_BOARD_KIND_OPTIONS.map((option) => String(option.value)));

const properties: INodeProperties[] = [
	{
		...workspaceResourceLocator,
		name: 'formWorkspaceId',
		required: true,
		description: 'The workspace to create the form and its response board in',
	},
	{
		displayName: 'Options',
		name: 'createFormOptions',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [
			{
				displayName: 'Board Kind',
				name: 'boardKind',
				type: 'options',
				options: FORM_BOARD_KIND_OPTIONS,
				default: 'public',
				description: 'Who can see the board that stores the responses',
			},
			{
				displayName: 'Board Name',
				name: 'destinationName',
				type: 'string',
				default: '',
				description:
					'The name of the board that stores the responses. The form name is always New Form. Use Update to change it.',
			},
			{
				displayName: 'Folder Name or ID',
				name: 'destinationFolderId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getFormWorkspaceFolders',
					loadOptionsDependsOn: ['formWorkspaceId.value'],
				},
				default: '',
				description:
					'The folder to create the form in. Select a workspace first. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			buildUserRowsProperty({
				displayName: 'Owners',
				name: 'ownerIds',
				includeTeams: true,
				description:
					'The users and teams to set as owners of the response board. In expression mode, pass a comma-separated string of user IDs and <code>team:&lt;ID&gt;</code> values.',
			}),
			buildUserRowsProperty({
				displayName: 'Subscribers',
				name: 'subscriberIds',
				includeTeams: true,
				description:
					'The users and teams to subscribe to the response board. In expression mode, pass a comma-separated string of user IDs and <code>team:&lt;ID&gt;</code> values.',
			}),
		],
	},
];

const displayOptions = {
	show: {
		resource: ['form'],
		operation: ['createForm'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/** Form: Create — create_form. monday.com also creates a board for the responses. */
export async function execute(
	this: IExecuteFunctions,
	client: MondayGraphQLClient,
	itemIndex: number,
): Promise<IDataObject> {
	const workspaceId = String(
		this.getNodeParameter('formWorkspaceId', itemIndex, '', { extractValue: true }),
	).trim();
	const options = this.getNodeParameter('createFormOptions', itemIndex, {}) as IDataObject;

	const boardKind = typeof options.boardKind === 'string' ? options.boardKind : '';
	if (boardKind !== '' && !BOARD_KINDS.has(boardKind)) {
		throw new NodeOperationError(this.getNode(), `Board Kind "${boardKind}" is not supported`, {
			itemIndex,
			description: `Use one of: ${[...BOARD_KINDS].join(', ')}.`,
		});
	}
	const owners = splitUserTeamIds(extractUserRowIds(options.ownerIds));
	const subscribers = splitUserTeamIds(extractUserRowIds(options.subscriberIds));
	// An ID in both lists becomes a subscriber only. Owners are always subscribed.
	const userSubscribers = subscribers.userIds.filter((id) => !owners.userIds.includes(id));
	const teamSubscribers = subscribers.teamIds.filter((id) => !owners.teamIds.includes(id));
	const idsOrNull = (ids: string[]) => (ids.length > 0 ? ids : null);

	let data: IDataObject;
	try {
		data = await client.execute(
			`mutation ($workspaceId: ID!, $boardKind: BoardKind, $name: String, $folderId: ID, $ownerIds: [ID!], $ownerTeamIds: [ID!], $subscriberIds: [ID!], $subscriberTeamIds: [ID!]) {
				create_form(
					destination_workspace_id: $workspaceId,
					board_kind: $boardKind,
					destination_name: $name,
					destination_folder_id: $folderId,
					board_owner_ids: $ownerIds,
					board_owner_team_ids: $ownerTeamIds,
					board_subscriber_ids: $subscriberIds,
					board_subscriber_teams_ids: $subscriberTeamIds
				) { boardId token }
			}`,
			itemIndex,
			{
				workspaceId,
				boardKind: boardKind || null,
				name: typeof options.destinationName === 'string' ? options.destinationName || null : null,
				folderId: options.destinationFolderId ? String(options.destinationFolderId) : null,
				ownerIds: idsOrNull(owners.userIds),
				ownerTeamIds: idsOrNull(owners.teamIds),
				subscriberIds: idsOrNull(userSubscribers),
				subscriberTeamIds: idsOrNull(teamSubscribers),
			},
		);
	} catch (error) {
		// monday.com gives USER_UNAUTHORIZED also for a workspace ID that does not exist.
		const { code, message } = mondayError(error);
		if (code === 'USER_UNAUTHORIZED') {
			throw new NodeOperationError(
				this.getNode(),
				`Workspace ${workspaceId} was not found, or you have no access to it`,
				{ itemIndex, description: `monday.com: ${message}` },
			);
		}
		throw error;
	}

	const created = (data.create_form ?? {}) as IDataObject;
	const token = typeof created.token === 'string' ? created.token : '';
	return { ...created, formUrl: token ? formUrl(token) : null };
}
