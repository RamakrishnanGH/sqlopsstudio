/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { localize } from 'vs/nls';
import * as vscode from 'vscode';
import { TPromise } from 'vs/base/common/winjs.base';
import { SqlMainContext, ExtHostModelViewTreeViewsShape, MainThreadModelViewShape } from 'sql/workbench/api/node/sqlExtHost.protocol';
import { ITreeComponentItem } from 'sql/workbench/common/views';
import { CommandsConverter } from 'vs/workbench/api/node/extHostCommands';
import { asWinJsPromise } from 'vs/base/common/async';
import { IMainContext } from 'vs/workbench/api/node/extHost.protocol';
import * as sqlops from 'sqlops';
import * as  vsTreeExt from 'vs/workbench/api/node/extHostTreeViews';

export class ExtHostModelViewTreeViews implements ExtHostModelViewTreeViewsShape {
	private _proxy: MainThreadModelViewShape;

	private treeViews: Map<string, ExtHostTreeView<any>> = new Map<string, ExtHostTreeView<any>>();


	constructor(
		private _mainContext: IMainContext
	) {
		this._proxy = this._mainContext.getProxy(SqlMainContext.MainThreadModelView);
	}

	$createTreeView<T>(handle: number, componentId: string, options: { treeDataProvider: sqlops.TreeComponentDataProvider<T> }): vscode.TreeView<T> {
		if (!options || !options.treeDataProvider) {
			throw new Error('Options with treeDataProvider is mandatory');
		}

		const treeView = this.createExtHostTreeViewer(handle, componentId, options.treeDataProvider);
		return {
			reveal: (element: T, options?: { select?: boolean }): Thenable<void> => {
				return treeView.reveal(element, options);
			},
			dispose: () => {
				this.treeViews.delete(componentId);
				treeView.dispose();
			}
		};
	}

	$getChildren(treeViewId: string, treeItemHandle?: string): TPromise<ITreeComponentItem[]> {
		const treeView = this.treeViews.get(treeViewId);
		if (!treeView) {

			return TPromise.wrapError<ITreeComponentItem[]>(new Error(localize('treeView.notRegistered', 'No tree view with id \'{0}\' registered.', treeViewId)));
		}
		return treeView.getChildren(treeItemHandle);
	}

	$onNodeCheckedChanged(treeViewId: string, treeItemHandle?: string, checked?: boolean): void {
		const treeView = this.treeViews.get(treeViewId);
		if (treeView) {
			treeView.onNodeCheckedChanged(treeItemHandle, checked);
		}
	}

	private createExtHostTreeViewer<T>(handle: number, id: string, dataProvider: sqlops.TreeComponentDataProvider<T>): ExtHostTreeView<T> {
		const treeView = new ExtHostTreeView<T>(handle, id, dataProvider, this._proxy, undefined);
		this.treeViews.set(`${handle}-${id}`, treeView);
		return treeView;
	}
}

export class ExtHostTreeView<T> extends vsTreeExt.ExtHostTreeView<T> {

	constructor(private handle: number, private componentId: string, private componentDataProvider: sqlops.TreeComponentDataProvider<T>, private modelViewProxy: MainThreadModelViewShape, commands: CommandsConverter) {
		super(componentId, componentDataProvider, undefined, commands);
	}

	onNodeCheckedChanged(parentHandle?: vsTreeExt.TreeItemHandle, checked?: boolean): void {
		const parentElement = parentHandle ? this.getExtensionElement(parentHandle) : void 0;
		if (parentHandle && !parentElement) {
			console.error(`No tree item with id \'${parentHandle}\' found.`);
		}

		this.componentDataProvider.onNodeCheckedChanged(parentElement, checked);
	}

	reveal(element: T, options?: { select?: boolean }): TPromise<void> {
		if (typeof this.componentDataProvider.getParent !== 'function') {
			return TPromise.wrapError(new Error(`Required registered TreeDataProvider to implement 'getParent' method to access 'reveal' method`));
		}
		let i: void;
		return this.resolveUnknownParentChain(element)
			.then(parentChain => this.resolveTreeNode(element, parentChain[parentChain.length - 1])
				.then(treeNode => i));
	}

	protected refresh(elements: T[]): void {
		const hasRoot = elements.some(element => !element);
		if (hasRoot) {
			this.clearAll(); // clear cache
			this.modelViewProxy.$refreshDataProvider(this.handle, this.componentId);
		} else {
			const handlesToRefresh = this.getHandlesToRefresh(elements);
			if (handlesToRefresh.length) {
				this.refreshHandles(handlesToRefresh);
			}
		}
	}

	protected refreshHandles(itemHandles: vsTreeExt.TreeItemHandle[]): TPromise<void> {
		const itemsToRefresh: { [treeItemHandle: string]: ITreeComponentItem } = {};
		return TPromise.join(itemHandles.map(treeItemHandle =>
			this.refreshNode(treeItemHandle)
				.then(node => {
					if (node) {
						itemsToRefresh[treeItemHandle] = node.item;
					}
				})))
			.then(() => Object.keys(itemsToRefresh).length ? this.modelViewProxy.$refreshDataProvider(this.handle, this.componentId, itemsToRefresh) : null);
	}

	protected refreshNode(treeItemHandle: vsTreeExt.TreeItemHandle): TPromise<vsTreeExt.TreeNode> {
		const extElement = this.getExtensionElement(treeItemHandle);
		const existing = this.nodes.get(extElement);
		//this.clearChildren(extElement); // clear children cache
		return asWinJsPromise(() => this.componentDataProvider.getTreeItem(extElement))
			.then(extTreeItem => {
				if (extTreeItem) {
					const newNode = this.createTreeNode(extElement, extTreeItem, existing.parent);
					this.updateNodeCache(extElement, newNode, existing, existing.parent);
					return newNode;
				}
				return null;
			});
	}

	protected createTreeItem(element: T, extensionTreeItem: sqlops.TreeComponentItem, parent?: vsTreeExt.TreeNode): ITreeComponentItem {
		let item = super.createTreeItem(element, extensionTreeItem, parent);
		item = Object.assign({}, item, { checked: extensionTreeItem.checked });
		return item;
	}
}