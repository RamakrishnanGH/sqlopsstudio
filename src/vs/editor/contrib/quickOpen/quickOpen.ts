/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { illegalArgument, onUnexpectedExternalError } from 'vs/base/common/errors';
import URI from 'vs/base/common/uri';
import { TPromise } from 'vs/base/common/winjs.base';
import { Range } from 'vs/editor/common/core/range';
import { ITextModel } from 'vs/editor/common/model';
import { registerLanguageCommand } from 'vs/editor/browser/editorExtensions';
import { SymbolInformation, DocumentSymbolProviderRegistry, IOutline } from 'vs/editor/common/modes';
import { IModelService } from 'vs/editor/common/services/modelService';
import { asWinJsPromise } from 'vs/base/common/async';

export function getDocumentSymbols(model: ITextModel): TPromise<IOutline> {

	let entries: SymbolInformation[] = [];

	let promises = DocumentSymbolProviderRegistry.all(model).map(support => {

		return asWinJsPromise((token) => {
			return support.provideDocumentSymbols(model, token);
		}).then(result => {
			if (Array.isArray(result)) {
				entries.push(...result);
			}
		}, err => {
			onUnexpectedExternalError(err);
		});
	});

	return TPromise.join(promises).then(() => {
		let flatEntries: SymbolInformation[] = [];
		flatten(flatEntries, entries, '');
		flatEntries.sort(compareEntriesUsingStart);

		return {
			entries: flatEntries,
		};
	});
}

function compareEntriesUsingStart(a: SymbolInformation, b: SymbolInformation): number {
	return Range.compareRangesUsingStarts(Range.lift(a.location.range), Range.lift(b.location.range));
}

function flatten(bucket: SymbolInformation[], entries: SymbolInformation[], overrideContainerLabel: string): void {
	for (let entry of entries) {
		bucket.push({
			kind: entry.kind,
			location: entry.location,
			name: entry.name,
			containerName: entry.containerName || overrideContainerLabel
		});
	}
}


registerLanguageCommand('_executeDocumentSymbolProvider', function (accessor, args) {
	const { resource } = args;
	if (!(resource instanceof URI)) {
		throw illegalArgument('resource');
	}
	const model = accessor.get(IModelService).getModel(resource);
	if (!model) {
		throw illegalArgument('resource');
	}
	return getDocumentSymbols(model);
});
