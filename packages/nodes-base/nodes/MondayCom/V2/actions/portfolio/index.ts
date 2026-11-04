import type { INodeProperties } from 'n8n-workflow';

import * as connectProjectToPortfolio from './connectProjectToPortfolio.operation';
import * as createPortfolio from './createPortfolio.operation';
import * as createProject from './createProject.operation';

export { connectProjectToPortfolio, createPortfolio, createProject };

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['portfolio'] } },
		options: [
			{
				name: 'Connect Project',
				value: 'connectProjectToPortfolio',
				action: 'Connect a project to a portfolio',
				description: 'Add an existing project to a portfolio. It needs an Enterprise plan.',
			},
			{
				name: 'Create Portfolio',
				value: 'createPortfolio',
				action: 'Create a portfolio',
				description:
					'Create a portfolio board for an overview of many projects. It needs an Enterprise plan.',
			},
			{
				name: 'Create Project',
				value: 'createProject',
				action: 'Create a project',
				description: 'Create a project, and connect it to a portfolio if you want',
			},
		],
		default: 'createProject',
	},
	...connectProjectToPortfolio.description,
	...createPortfolio.description,
	...createProject.description,
];
