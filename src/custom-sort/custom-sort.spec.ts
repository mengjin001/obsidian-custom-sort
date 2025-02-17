import {CachedMetadata, MetadataCache, Pos, TFile, TFolder, Vault} from 'obsidian';
import {
	DEFAULT_FOLDER_CTIME,
	DEFAULT_FOLDER_MTIME,
	determineFolderDatesIfNeeded,
	determineSortingGroup,
	FolderItemForSorting,
	matchGroupRegex,
	SorterFn,
	Sorters
} from './custom-sort';
import {CustomSortGroupType, CustomSortOrder, CustomSortSpec, RegExpSpec} from './custom-sort-types';
import {CompoundDashNumberNormalizerFn, CompoundDotRomanNumberNormalizerFn} from "./sorting-spec-processor";
import {findStarredFile_pathParam, Starred_PluginInstance} from "../utils/StarredPluginSignature";

const mockTFile = (basename: string, ext: string, size?: number, ctime?: number, mtime?: number): TFile => {
	return {
		stat: {
			ctime: ctime ?? 0,
			mtime: mtime ?? 0,
			size: size ?? 0
		},
		basename: basename,
		extension: ext,
		vault: {} as Vault, // To satisfy TS typechecking
		path: `Some parent folder/${basename}.${ext}`,
		name: `${basename}.${ext}`,
		parent: {} as TFolder // To satisfy TS typechecking
	}
}

const mockTFolder = (name: string, children?: Array<TFolder|TFile>, parent?: TFolder): TFolder => {
	return {
		isRoot(): boolean { return name === '/' },
		vault: {} as Vault, // To satisfy TS typechecking
		path: `${name}`,
		name: name,
		parent: parent ?? ({} as TFolder), // To satisfy TS typechecking
		children: children ?? []
	}
}

const MOCK_TIMESTAMP: number = 1656417542418
const TIMESTAMP_OLDEST: number = MOCK_TIMESTAMP
const TIMESTAMP_NEWEST: number = MOCK_TIMESTAMP + 1000
const TIMESTAMP_INBETWEEN: number = MOCK_TIMESTAMP + 500

const mockTFolderWithChildren = (name: string): TFolder => {
	const child1: TFolder = mockTFolder('Section A')
	const child2: TFolder = mockTFolder('Section B')
	const child3: TFile = mockTFile('Child file 1 created as oldest, modified recently', 'md', 100, TIMESTAMP_OLDEST, TIMESTAMP_NEWEST)
	const child4: TFile = mockTFile('Child file 2 created as newest, not modified at all', 'md', 100, TIMESTAMP_NEWEST, TIMESTAMP_NEWEST)
	const child5: TFile = mockTFile('Child file 3 created inbetween, modified inbetween', 'md', 100, TIMESTAMP_INBETWEEN, TIMESTAMP_INBETWEEN)

	return mockTFolder(name, [child1, child2, child3, child4, child5])
}

const MockedLoc: Pos = {
	start: {col:0,offset:0,line:0},
	end: {col:0,offset:0,line:0}
}

describe('determineSortingGroup', () => {
	describe('CustomSortGroupType.ExactHeadAndTail', () => {
		it('should correctly recognize head and tail', () => {
			// given
			const file: TFile = mockTFile('References', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.ExactHeadAndTail,
					exactPrefix: 'Ref',
					exactSuffix: 'ces'
				}]
			}

			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 0,
				isFolder: false,
				sortString: "References.md",
				ctimeNewest: MOCK_TIMESTAMP + 222,
				ctimeOldest: MOCK_TIMESTAMP + 222,
				mtime: MOCK_TIMESTAMP + 333,
				path: 'Some parent folder/References.md'
			});
		})
		it('should not allow overlap of head and tail', () => {
			// given
			const file: TFile = mockTFile('References', 'md', 444, MOCK_TIMESTAMP + 555, MOCK_TIMESTAMP + 666);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.ExactHeadAndTail,
					exactPrefix: 'Referen',
					exactSuffix: 'rences'
				}]
			}

			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 1, // This indicates the last+1 idx (no match)
				isFolder: false,
				sortString: "References.md",
				ctimeNewest: MOCK_TIMESTAMP + 555,
				ctimeOldest: MOCK_TIMESTAMP + 555,
				mtime: MOCK_TIMESTAMP + 666,
				path: 'Some parent folder/References.md'
			});
		})
		it('should not allow overlap of head and tail, when simple regexp in head', () => {
			// given
			const file: TFile = mockTFile('Part123:-icle', 'md', 444, MOCK_TIMESTAMP + 555, MOCK_TIMESTAMP + 666);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['Some parent folder'],
				groups: [{
					type: CustomSortGroupType.ExactHeadAndTail,
					regexPrefix: {
						regex: /^Part\d\d\d:/i
					},
					exactSuffix: ':-icle'
				}]
			}

			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 1, // This indicates the last+1 idx (no match)
				isFolder: false,
				sortString: "Part123:-icle.md",
				ctimeNewest: MOCK_TIMESTAMP + 555,
				ctimeOldest: MOCK_TIMESTAMP + 555,
				mtime: MOCK_TIMESTAMP + 666,
				path: 'Some parent folder/Part123:-icle.md'
			});
		})
		it('should not allow overlap of head and tail, when advanced regexp in head', () => {
			// given
			const file: TFile = mockTFile('Part123:-icle', 'md', 444, MOCK_TIMESTAMP + 555, MOCK_TIMESTAMP + 666);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['Some parent folder'],
				groups: [{
					type: CustomSortGroupType.ExactHeadAndTail,
					regexPrefix: {
						regex: /^Part *(\d+(?:-\d+)*):/i,
						normalizerFn: CompoundDashNumberNormalizerFn
					},
					exactSuffix: ':-icle'
				}]
			}

			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 1, // This indicates the last+1 idx
				isFolder: false,
				sortString: "Part123:-icle.md",
				ctimeNewest: MOCK_TIMESTAMP + 555,
				ctimeOldest: MOCK_TIMESTAMP + 555,
				mtime: MOCK_TIMESTAMP + 666,
				path: 'Some parent folder/Part123:-icle.md'
			});
		})
		it('should match head and tail, when simple regexp in head', () => {
			// given
			const file: TFile = mockTFile('Part123:-icle', 'md', 444, MOCK_TIMESTAMP + 555, MOCK_TIMESTAMP + 666);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['Some parent folder'],
				groups: [{
					type: CustomSortGroupType.ExactHeadAndTail,
					regexPrefix: {
						regex: /^Part\d\d\d:/i,
						normalizerFn: CompoundDashNumberNormalizerFn
					},
					exactSuffix: '-icle'
				}]
			}

			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 0, // Matched!
				isFolder: false,
				sortString: "Part123:-icle.md",
				ctimeNewest: MOCK_TIMESTAMP + 555,
				ctimeOldest: MOCK_TIMESTAMP + 555,
				mtime: MOCK_TIMESTAMP + 666,
				path: 'Some parent folder/Part123:-icle.md'
			});
		})
		it('should match head and tail, when advanced regexp in head', () => {
			// given
			const file: TFile = mockTFile('Part123:-icle', 'md', 444, MOCK_TIMESTAMP + 555, MOCK_TIMESTAMP + 666);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['Some parent folder'],
				groups: [{
					type: CustomSortGroupType.ExactHeadAndTail,
					regexPrefix: {
						regex: /^Part *(\d+(?:-\d+)*):/i,
						normalizerFn: CompoundDashNumberNormalizerFn
					},
					exactSuffix: '-icle'
				}]
			}

			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 0, // Matched!
				isFolder: false,
				sortString: "00000123////Part123:-icle.md",
				matchGroup: '00000123//',
				ctimeNewest: MOCK_TIMESTAMP + 555,
				ctimeOldest: MOCK_TIMESTAMP + 555,
				mtime: MOCK_TIMESTAMP + 666,
				path: 'Some parent folder/Part123:-icle.md'
			});
		})
		it('should not allow overlap of head and tail, when regexp in tail', () => {
			// given
			const file: TFile = mockTFile('Part:123-icle', 'md', 444, MOCK_TIMESTAMP + 555, MOCK_TIMESTAMP + 666);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['Some parent folder'],
				groups: [{
					type: CustomSortGroupType.ExactHeadAndTail,
					exactPrefix: 'Part:',
					regexSuffix: {
						regex: /: *(\d+(?:-\d+)*)-icle$/i,
						normalizerFn: CompoundDashNumberNormalizerFn
					}
				}]
			}

			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 1, // This indicates the last+1 idx
				isFolder: false,
				sortString: "Part:123-icle.md",
				ctimeNewest: MOCK_TIMESTAMP + 555,
				ctimeOldest: MOCK_TIMESTAMP + 555,
				mtime: MOCK_TIMESTAMP + 666,
				path: 'Some parent folder/Part:123-icle.md'
			});
		});
		it('should match head and tail, when simple regexp in head and tail', () => {
			// given
			const file: TFile = mockTFile('Part:123-icle', 'md', 444, MOCK_TIMESTAMP + 555, MOCK_TIMESTAMP + 666);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['Some parent folder'],
				groups: [{
					type: CustomSortGroupType.ExactHeadAndTail,
					regexPrefix: {
						regex: /^Part:\d/i
					},
					regexSuffix: {
						regex: /\d-icle$/i
					}
				}]
			}

			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 0, // Matched!
				isFolder: false,
				sortString: "Part:123-icle.md",
				ctimeNewest: MOCK_TIMESTAMP + 555,
				ctimeOldest: MOCK_TIMESTAMP + 555,
				mtime: MOCK_TIMESTAMP + 666,
				path: 'Some parent folder/Part:123-icle.md'
			});
		});
		it('should match head and tail, when simple regexp in head and and mixed in tail', () => {
			// given
			const file: TFile = mockTFile('Part:1 1-23.456-icle', 'md', 444, MOCK_TIMESTAMP + 555, MOCK_TIMESTAMP + 666);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['Some parent folder'],
				groups: [{
					type: CustomSortGroupType.ExactHeadAndTail,
					regexPrefix: {
						regex: /^Part:\d/i
					},
					regexSuffix: {
						regex: / *(\d+(?:-\d+)*).\d\d\d-icle$/i,
						normalizerFn: CompoundDashNumberNormalizerFn
					}
				}]
			}

			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 0, // Matched!
				isFolder: false,
				sortString: "00000001|00000023////Part:1 1-23.456-icle.md",
				matchGroup: '00000001|00000023//',
				ctimeNewest: MOCK_TIMESTAMP + 555,
				ctimeOldest: MOCK_TIMESTAMP + 555,
				mtime: MOCK_TIMESTAMP + 666,
				path: 'Some parent folder/Part:1 1-23.456-icle.md'
			});
		});
		it('should match head and tail, when advanced regexp in tail', () => {
			// given
			const file: TFile = mockTFile('Part:123-icle', 'md', 444, MOCK_TIMESTAMP + 555, MOCK_TIMESTAMP + 666);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['Some parent folder'],
				groups: [{
					type: CustomSortGroupType.ExactHeadAndTail,
					exactPrefix: 'Part',
					regexSuffix: {
						regex: /: *(\d+(?:-\d+)*)-icle$/i,
						normalizerFn: CompoundDashNumberNormalizerFn
					}
				}]
			}

			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 0, // Matched!
				isFolder: false,
				sortString: "00000123////Part:123-icle.md",
				matchGroup: '00000123//',
				ctimeNewest: MOCK_TIMESTAMP + 555,
				ctimeOldest: MOCK_TIMESTAMP + 555,
				mtime: MOCK_TIMESTAMP + 666,
				path: 'Some parent folder/Part:123-icle.md'
			});
		});
	})
	describe('CustomSortGroupType.ExactPrefix', () => {
		it('should correctly recognize exact prefix', () => {
			// given
			const file: TFile = mockTFile('References', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.ExactPrefix,
					exactPrefix: 'Ref'
				}]
			}

			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 0,
				isFolder: false,
				sortString: "References.md",
				ctimeNewest: MOCK_TIMESTAMP + 222,
				ctimeOldest: MOCK_TIMESTAMP + 222,
				mtime: MOCK_TIMESTAMP + 333,
				path: 'Some parent folder/References.md'
			});
		})
		it('should correctly recognize exact simple regex prefix', () => {
			// given
			const file: TFile = mockTFile('Ref2erences', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.ExactPrefix,
					regexPrefix: {
						regex: /Ref[0-9]/i
					}
				}]
			}

			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 0,
				isFolder: false,
				sortString: "Ref2erences.md",
				ctimeNewest: MOCK_TIMESTAMP + 222,
				ctimeOldest: MOCK_TIMESTAMP + 222,
				mtime: MOCK_TIMESTAMP + 333,
				path: 'Some parent folder/Ref2erences.md'
			});
		})
		it('should correctly recognize exact prefix, regexL variant', () => {
			// given
			const file: TFile = mockTFile('Reference i.xxx.vi.mcm', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.ExactPrefix,
					regexPrefix: {
						regex: /^Reference *([MDCLXVI]+(?:\.[MDCLXVI]+)*)/i,
						normalizerFn: CompoundDotRomanNumberNormalizerFn
					}
				}]
			}

			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 0,
				isFolder: false,
				sortString: '00000001|00000030|00000006|00001900////Reference i.xxx.vi.mcm.md',
				matchGroup: "00000001|00000030|00000006|00001900//",
				ctimeNewest: MOCK_TIMESTAMP + 222,
				ctimeOldest: MOCK_TIMESTAMP + 222,
				mtime: MOCK_TIMESTAMP + 333,
				path: 'Some parent folder/Reference i.xxx.vi.mcm.md'
			});
		})
		it('should correctly process not matching prefix', () => {
			// given
			const file: TFile = mockTFile('References', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.ExactPrefix,
					exactPrefix: 'Pref'
				}]
			}
			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 1, // This indicates the last+1 idx
				isFolder: false,
				sortString: "References.md",
				ctimeNewest: MOCK_TIMESTAMP + 222,
				ctimeOldest: MOCK_TIMESTAMP + 222,
				mtime: MOCK_TIMESTAMP + 333,
				path: 'Some parent folder/References.md'
			});
		})
	})
	describe('CustomSortGroupType.ExactSuffix', () => {
		it('should correctly recognize exact suffix', () => {
			// given
			const file: TFile = mockTFile('References', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.ExactSuffix,
					exactSuffix: 'ces'
				}]
			}

			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 0,
				isFolder: false,
				sortString: "References.md",
				ctimeNewest: MOCK_TIMESTAMP + 222,
				ctimeOldest: MOCK_TIMESTAMP + 222,
				mtime: MOCK_TIMESTAMP + 333,
				path: 'Some parent folder/References.md'
			});
		})
		it('should correctly recognize exact simple regex suffix', () => {
			// given
			const file: TFile = mockTFile('References 12', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.ExactSuffix,
					regexSuffix: {
						regex: /ces [0-9][0-9]$/i
					}
				}]
			}

			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 0,
				isFolder: false,
				sortString: "References 12.md",
				ctimeNewest: MOCK_TIMESTAMP + 222,
				ctimeOldest: MOCK_TIMESTAMP + 222,
				mtime: MOCK_TIMESTAMP + 333,
				path: 'Some parent folder/References 12.md'
			});
		})
		it('should correctly recognize exact suffix, regexL variant', () => {
			// given
			const file: TFile = mockTFile('Reference i.xxx.vi.mcm', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.ExactSuffix,
					regexSuffix: {
						regex: /  *([MDCLXVI]+(?:\.[MDCLXVI]+)*)$/i,
						normalizerFn: CompoundDotRomanNumberNormalizerFn
					}
				}]
			}

			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 0,
				isFolder: false,
				sortString: '00000001|00000030|00000006|00001900////Reference i.xxx.vi.mcm.md',
				matchGroup: "00000001|00000030|00000006|00001900//",
				ctimeNewest: MOCK_TIMESTAMP + 222,
				ctimeOldest: MOCK_TIMESTAMP + 222,
				mtime: MOCK_TIMESTAMP + 333,
				path: 'Some parent folder/Reference i.xxx.vi.mcm.md'
			});
		})
		it('should correctly process not matching suffix', () => {
			// given
			const file: TFile = mockTFile('References', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.ExactSuffix,
					exactSuffix: 'ence'
				}]
			}
			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 1, // This indicates the last+1 idx
				isFolder: false,
				sortString: "References.md",
				ctimeNewest: MOCK_TIMESTAMP + 222,
				ctimeOldest: MOCK_TIMESTAMP + 222,
				mtime: MOCK_TIMESTAMP + 333,
				path: 'Some parent folder/References.md'
			});
		})
		it('should correctly process not matching regex suffix', () => {
			// given
			const file: TFile = mockTFile('References', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.ExactSuffix,
					regexSuffix: {
						regex: /ence$/i
					}
				}]
			}
			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 1, // This indicates the last+1 idx
				isFolder: false,
				sortString: "References.md",
				ctimeNewest: MOCK_TIMESTAMP + 222,
				ctimeOldest: MOCK_TIMESTAMP + 222,
				mtime: MOCK_TIMESTAMP + 333,
				path: 'Some parent folder/References.md'
			});
		})
	})
	describe('CustomSortGroupType.ExactName', () => {
		it('should correctly recognize exact name', () => {
			// given
			const file: TFile = mockTFile('References', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.ExactName,
					exactText: 'References'
				}]
			}

			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 0,
				isFolder: false,
				sortString: "References.md",
				ctimeNewest: MOCK_TIMESTAMP + 222,
				ctimeOldest: MOCK_TIMESTAMP + 222,
				mtime: MOCK_TIMESTAMP + 333,
				path: 'Some parent folder/References.md'
			});
		})
		it('should correctly recognize exact simple regex-based name', () => {
			// given
			const file: TFile = mockTFile('References 12', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.ExactName,
					regexPrefix: {
						regex: /^References [0-9][0-9]$/i
					}
				}]
			}

			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 0,
				isFolder: false,
				sortString: "References 12.md",
				ctimeNewest: MOCK_TIMESTAMP + 222,
				ctimeOldest: MOCK_TIMESTAMP + 222,
				mtime: MOCK_TIMESTAMP + 333,
				path: 'Some parent folder/References 12.md'
			});
		})
		it('should correctly recognize exact name, regexL variant', () => {
			// given
			const file: TFile = mockTFile('Reference i.xxx.vi.mcm', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.ExactName,
					regexPrefix: {
						regex: /^Reference  *([MDCLXVI]+(?:\.[MDCLXVI]+)*)$/i,
						normalizerFn: CompoundDotRomanNumberNormalizerFn
					}
				}]
			}

			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 0,
				isFolder: false,
				sortString: '00000001|00000030|00000006|00001900////Reference i.xxx.vi.mcm.md',
				matchGroup: "00000001|00000030|00000006|00001900//",
				ctimeNewest: MOCK_TIMESTAMP + 222,
				ctimeOldest: MOCK_TIMESTAMP + 222,
				mtime: MOCK_TIMESTAMP + 333,
				path: 'Some parent folder/Reference i.xxx.vi.mcm.md'
			});
		})
		it('should correctly process not matching name', () => {
			// given
			const file: TFile = mockTFile('References', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.ExactName,
					exactText: 'ence'
				}]
			}
			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 1, // This indicates the last+1 idx
				isFolder: false,
				sortString: "References.md",
				ctimeNewest: MOCK_TIMESTAMP + 222,
				ctimeOldest: MOCK_TIMESTAMP + 222,
				mtime: MOCK_TIMESTAMP + 333,
				path: 'Some parent folder/References.md'
			});
		})
		it('should correctly process not matching regex name', () => {
			// given
			const file: TFile = mockTFile('References', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.ExactName,
					regexPrefix: {
						regex: /^Reference$/i
					}
				}]
			}
			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 1, // This indicates the last+1 idx
				isFolder: false,
				sortString: "References.md",
				ctimeNewest: MOCK_TIMESTAMP + 222,
				ctimeOldest: MOCK_TIMESTAMP + 222,
				mtime: MOCK_TIMESTAMP + 333,
				path: 'Some parent folder/References.md'
			});
		})
	})
	describe('CustomSortGroupType.byMetadataFieldAlphabetical', () => {
		it('should ignore the file item if it has no direct metadata', () => {
			// given
			const file: TFile = mockTFile('References', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.HasMetadataField,
					withMetadataFieldName: "metadataField1",
					exactPrefix: 'Ref'
				}],
				_mCache: {
					getCache: function (path: string): CachedMetadata | undefined {
						return {
							"References": {
								frontmatter: {
									metadataField1InvalidField: "directMetadataOnFile",
									position: MockedLoc
								}
							}
						}[path]
					}
				} as MetadataCache
			}

			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 1,  // The lastIdx+1, group not determined
				isFolder: false,
				sortString: "References.md",
				ctimeNewest: MOCK_TIMESTAMP + 222,
				ctimeOldest: MOCK_TIMESTAMP + 222,
				mtime: MOCK_TIMESTAMP + 333,
				path: 'Some parent folder/References.md'
			});
		})
		it('should ignore the folder item if it has no metadata on folder note', () => {
			// given
			const file: TFile = mockTFile('References', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.HasMetadataField,
					withMetadataFieldName: "metadataField1",
					exactPrefix: 'Ref'
				}],
				_mCache: {
					getCache: function (path: string): CachedMetadata | undefined {
						return {
							"References": {
								frontmatter: {
									metadataField1: undefined,
									position: MockedLoc
								}
							}
						}[path]
					}
				} as MetadataCache
			}

			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 1,  // lastIdx + 1, group not determined
				isFolder: false,
				sortString: "References.md",
				ctimeNewest: MOCK_TIMESTAMP + 222,
				ctimeOldest: MOCK_TIMESTAMP + 222,
				mtime: MOCK_TIMESTAMP + 333,
				path: 'Some parent folder/References.md'
			});
		})
		it('should correctly include the File item if has direct metadata (group not sorted by metadata', () => {
			// given
			const file: TFile = mockTFile('References', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.HasMetadataField,
					withMetadataFieldName: "metadataField1",
					exactPrefix: 'Ref'
				}],
				_mCache: {
					getCache: function (path: string): CachedMetadata | undefined {
						return {
							'Some parent folder/References.md': {
								frontmatter: {
									"metadataField1": "directMetadataOnFile",
									position: MockedLoc
								}
							}
						}[path]
					}
				} as MetadataCache
			}

			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 0,
				isFolder: false,
				sortString: "References.md",
				ctimeNewest: MOCK_TIMESTAMP + 222,
				ctimeOldest: MOCK_TIMESTAMP + 222,
				mtime: MOCK_TIMESTAMP + 333,
				path: 'Some parent folder/References.md'
			} as FolderItemForSorting);
		})
		it('should correctly include the Folder item if it has folder note metadata (group not sorted by metadata', () => {
			// given
			const folder: TFolder = mockTFolder('References');
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.HasMetadataField,
					withMetadataFieldName: "metadataField1",
					exactPrefix: 'Ref'
				}],
				_mCache: {
					getCache: function (path: string): CachedMetadata | undefined {
						return {
							'References/References.md': {
								frontmatter: {
									"metadataField1": "directMetadataOnFile",
									position: MockedLoc
								}
							}
						}[path]
					}
				} as MetadataCache
			}

			// when
			const result = determineSortingGroup(folder, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 0,
				isFolder: true,
				sortString: "References",
				ctimeNewest: DEFAULT_FOLDER_CTIME,
				ctimeOldest: DEFAULT_FOLDER_CTIME,
				mtime: DEFAULT_FOLDER_MTIME,
				path: 'References',
				folder: folder
			} as FolderItemForSorting);
		})
	})
	describe('CustomSortGroupType.StarredOnly', () => {
		it('should not match not starred file', () => {
			// given
			const file: TFile = mockTFile('References', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.StarredOnly
				}]
			}
			const starredPluginInstance: Partial<Starred_PluginInstance> = {
				findStarredFile: jest.fn( function(filePath: findStarredFile_pathParam): TFile | null {
					return null
				})
			}

			// when
			const result = determineSortingGroup(file, sortSpec, {
				starredPluginInstance: starredPluginInstance as Starred_PluginInstance
			})

			// then
			expect(result).toEqual({
				groupIdx: 1,  // The lastIdx+1, group not determined
				isFolder: false,
				sortString: "References.md",
				ctimeNewest: MOCK_TIMESTAMP + 222,
				ctimeOldest: MOCK_TIMESTAMP + 222,
				mtime: MOCK_TIMESTAMP + 333,
				path: 'Some parent folder/References.md'
			});
			expect(starredPluginInstance.findStarredFile).toHaveBeenCalledTimes(1)
		})
		it('should match starred file', () => {
			// given
			const file: TFile = mockTFile('References', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.StarredOnly
				}]
			}
			const starredPluginInstance: Partial<Starred_PluginInstance> = {
				findStarredFile: jest.fn( function(filePath: findStarredFile_pathParam): TFile | null {
					return filePath.path === 'Some parent folder/References.md' ? file : null
				})
			}

			// when
			const result = determineSortingGroup(file, sortSpec, {
				starredPluginInstance: starredPluginInstance as Starred_PluginInstance
			})

			// then
			expect(result).toEqual({
				groupIdx: 0,
				isFolder: false,
				sortString: "References.md",
				ctimeNewest: MOCK_TIMESTAMP + 222,
				ctimeOldest: MOCK_TIMESTAMP + 222,
				mtime: MOCK_TIMESTAMP + 333,
				path: 'Some parent folder/References.md'
			});
			expect(starredPluginInstance.findStarredFile).toHaveBeenCalledTimes(1)
		})
		it('should not match empty folder', () => {
			// given
			const folder: TFolder = mockTFolder('TestEmptyFolder');
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.StarredOnly
				}]
			}
			const starredPluginInstance: Partial<Starred_PluginInstance> = {
				findStarredFile: jest.fn( function(filePath: findStarredFile_pathParam): TFile | null {
					return filePath.path === 'Some parent folder/References.md' ? {} as TFile : null
				})
			}

			// when
			const result = determineSortingGroup(folder, sortSpec, {
				starredPluginInstance: starredPluginInstance as Starred_PluginInstance
			})

			// then
			expect(result).toEqual({
				groupIdx: 1,  // The lastIdx+1, group not determined
				isFolder: true,
				sortString: "TestEmptyFolder",
				ctimeNewest: 0,
				ctimeOldest: 0,
				mtime: 0,
				path: 'TestEmptyFolder',
				folder: {
					children: [],
					isRoot: expect.any(Function),
					name: "TestEmptyFolder",
					parent: {},
					path: "TestEmptyFolder",
					vault: {}
				}
			});
			expect(starredPluginInstance.findStarredFile).not.toHaveBeenCalled()
		})
		it('should not match folder w/o starred items', () => {
			// given
			const folder: TFolder = mockTFolderWithChildren('TestEmptyFolder');
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.StarredOnly
				}]
			}
			const starredPluginInstance: Partial<Starred_PluginInstance> = {
				findStarredFile: jest.fn( function(filePath: findStarredFile_pathParam): TFile | null {
					return filePath.path === 'Some parent folder/References.md' ? {} as TFile : null
				})
			}

			// when
			const result = determineSortingGroup(folder, sortSpec, {
				starredPluginInstance: starredPluginInstance as Starred_PluginInstance
			})

			// then
			expect(result).toEqual({
				groupIdx: 1,  // The lastIdx+1, group not determined
				isFolder: true,
				sortString: "TestEmptyFolder",
				ctimeNewest: 0,
				ctimeOldest: 0,
				mtime: 0,
				path: 'TestEmptyFolder',
				folder: {
					children: expect.any(Array),
					isRoot: expect.any(Function),
					name: "TestEmptyFolder",
					parent: {},
					path: "TestEmptyFolder",
					vault: {}
				}
			});
			expect(starredPluginInstance.findStarredFile).toHaveBeenCalledTimes(folder.children.filter(f => (f as any).isRoot === undefined).length)
		})
		it('should match folder with one starred item', () => {
			// given
			const folder: TFolder = mockTFolderWithChildren('TestEmptyFolder');
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.StarredOnly
				}]
			}
			const starredPluginInstance: Partial<Starred_PluginInstance> = {
				findStarredFile: jest.fn(function (filePath: findStarredFile_pathParam): TFile | null {
					return filePath.path === 'Some parent folder/Child file 2 created as newest, not modified at all.md' ? {} as TFile : null
				})
			}

			// when
			const result = determineSortingGroup(folder, sortSpec, {
				starredPluginInstance: starredPluginInstance as Starred_PluginInstance
			})

			// then
			expect(result).toEqual({
				groupIdx: 0,
				isFolder: true,
				sortString: "TestEmptyFolder",
				ctimeNewest: 0,
				ctimeOldest: 0,
				mtime: 0,
				path: 'TestEmptyFolder',
				folder: {
					children: expect.any(Array),
					isRoot: expect.any(Function),
					name: "TestEmptyFolder",
					parent: {},
					path: "TestEmptyFolder",
					vault: {}
				}
			});
				// assume optimized checking of starred items -> first match ends the check
			expect(starredPluginInstance.findStarredFile).toHaveBeenCalledTimes(2)
		})
	})
	describe('when sort by metadata is involved', () => {
		it('should correctly read direct metadata from File item (order by metadata set on group) alph', () => {
			// given
			const file: TFile = mockTFile('References', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.ExactPrefix,
					byMetadataField: 'metadata-field-for-sorting',
					exactPrefix: 'Ref',
					order: CustomSortOrder.byMetadataFieldAlphabetical
				}],
				_mCache: {
					getCache: function (path: string): CachedMetadata | undefined {
						return {
							'Some parent folder/References.md': {
								frontmatter: {
									"metadata-field-for-sorting": "direct metadata on file",
									position: MockedLoc
								}
							}
						}[path]
					}
				} as MetadataCache
			}

			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 0,
				isFolder: false,
				sortString: "References.md",
				ctimeNewest: MOCK_TIMESTAMP + 222,
				ctimeOldest: MOCK_TIMESTAMP + 222,
				mtime: MOCK_TIMESTAMP + 333,
				path: 'Some parent folder/References.md',
				metadataFieldValue: 'direct metadata on file'
			} as FolderItemForSorting);
		})
		it('should correctly read direct metadata from File item (order by metadata set on group) alph rev', () => {
			// given
			const file: TFile = mockTFile('References', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.ExactPrefix,
					byMetadataField: 'metadata-field-for-sorting',
					exactPrefix: 'Ref',
					order: CustomSortOrder.byMetadataFieldAlphabeticalReverse
				}],
				_mCache: {
					getCache: function (path: string): CachedMetadata | undefined {
						return {
							'Some parent folder/References.md': {
								frontmatter: {
									"metadata-field-for-sorting": "direct metadata on file",
									position: MockedLoc
								}
							}
						}[path]
					}
				} as MetadataCache
			}

			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 0,
				isFolder: false,
				sortString: "References.md",
				ctimeNewest: MOCK_TIMESTAMP + 222,
				ctimeOldest: MOCK_TIMESTAMP + 222,
				mtime: MOCK_TIMESTAMP + 333,
				path: 'Some parent folder/References.md',
				metadataFieldValue: 'direct metadata on file'
			} as FolderItemForSorting);
		})
		it('should correctly read direct metadata from File item (order by metadata set on group) true alph', () => {
			// given
			const file: TFile = mockTFile('References', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.ExactPrefix,
					byMetadataField: 'metadata-field-for-sorting',
					exactPrefix: 'Ref',
					order: CustomSortOrder.byMetadataFieldTrueAlphabetical
				}],
				_mCache: {
					getCache: function (path: string): CachedMetadata | undefined {
						return {
							'Some parent folder/References.md': {
								frontmatter: {
									"metadata-field-for-sorting": "direct metadata on file",
									position: MockedLoc
								}
							}
						}[path]
					}
				} as MetadataCache
			}

			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 0,
				isFolder: false,
				sortString: "References.md",
				ctimeNewest: MOCK_TIMESTAMP + 222,
				ctimeOldest: MOCK_TIMESTAMP + 222,
				mtime: MOCK_TIMESTAMP + 333,
				path: 'Some parent folder/References.md',
				metadataFieldValue: 'direct metadata on file'
			} as FolderItemForSorting);
		})
		it('should correctly read direct metadata from File item (order by metadata set on group) true alph rev', () => {
			// given
			const file: TFile = mockTFile('References', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.ExactPrefix,
					byMetadataField: 'metadata-field-for-sorting',
					exactPrefix: 'Ref',
					order: CustomSortOrder.byMetadataFieldTrueAlphabeticalReverse
				}],
				_mCache: {
					getCache: function (path: string): CachedMetadata | undefined {
						return {
							'Some parent folder/References.md': {
								frontmatter: {
									"metadata-field-for-sorting": "direct metadata on file",
									position: MockedLoc
								}
							}
						}[path]
					}
				} as MetadataCache
			}

			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 0,
				isFolder: false,
				sortString: "References.md",
				ctimeNewest: MOCK_TIMESTAMP + 222,
				ctimeOldest: MOCK_TIMESTAMP + 222,
				mtime: MOCK_TIMESTAMP + 333,
				path: 'Some parent folder/References.md',
				metadataFieldValue: 'direct metadata on file'
			} as FolderItemForSorting);
		})
		it('should correctly read direct metadata from folder note item (order by metadata set on group)', () => {
			// given
			const folder: TFolder = mockTFolder('References');
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.ExactPrefix,
					exactPrefix: 'Ref',
					byMetadataField: 'metadata-field-for-sorting',
					order: CustomSortOrder.byMetadataFieldAlphabeticalReverse
				}],
				_mCache: {
					getCache: function (path: string): CachedMetadata | undefined {
						return {
							'References/References.md': {
								frontmatter: {
									'metadata-field-for-sorting': "metadata on folder note",
									position: MockedLoc
								}
							}
						}[path]
					}
				} as MetadataCache
			}

			// when
			const result = determineSortingGroup(folder, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 0,
				isFolder: true,
				sortString: "References",
				ctimeNewest: DEFAULT_FOLDER_CTIME,
				ctimeOldest: DEFAULT_FOLDER_CTIME,
				mtime: DEFAULT_FOLDER_MTIME,
				path: 'References',
				metadataFieldValue: 'metadata on folder note',
				folder: folder
			} as FolderItemForSorting);
		})
		it('should correctly read direct metadata from File item (order by metadata set on target folder)', () => {
			// given
			const file: TFile = mockTFile('References', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.ExactPrefix,
					exactPrefix: 'Ref',
					order: CustomSortOrder.byMetadataFieldAlphabetical
				}],
				_mCache: {
					getCache: function (path: string): CachedMetadata | undefined {
						return {
							'Some parent folder/References.md': {
								frontmatter: {
									"metadata-field-for-sorting-specified-on-target-folder": "direct metadata on file, not obvious",
									position: MockedLoc
								}
							}
						}[path]
					}
				} as MetadataCache,
				defaultOrder: CustomSortOrder.byMetadataFieldAlphabeticalReverse,
				byMetadataField: 'metadata-field-for-sorting-specified-on-target-folder',
			}

			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 0,
				isFolder: false,
				sortString: "References.md",
				ctimeNewest: MOCK_TIMESTAMP + 222,
				ctimeOldest: MOCK_TIMESTAMP + 222,
				mtime: MOCK_TIMESTAMP + 333,
				path: 'Some parent folder/References.md',
				metadataFieldValue: 'direct metadata on file, not obvious'
			} as FolderItemForSorting);
		})
		it('should correctly read direct metadata from File item (order by metadata set on group, no metadata name specified on group)', () => {
			// given
			const file: TFile = mockTFile('References', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.HasMetadataField,
					order: CustomSortOrder.byMetadataFieldAlphabetical,
					withMetadataFieldName: 'field-used-with-with-metadata-syntax'
				}],
				_mCache: {
					getCache: function (path: string): CachedMetadata | undefined {
						return {
							'Some parent folder/References.md': {
								frontmatter: {
									'field-used-with-with-metadata-syntax': "direct metadata on file, tricky",
									position: MockedLoc
								}
							}
						}[path]
					}
				} as MetadataCache
			}

			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 0,
				isFolder: false,
				sortString: "References.md",
				ctimeNewest: MOCK_TIMESTAMP + 222,
				ctimeOldest: MOCK_TIMESTAMP + 222,
				mtime: MOCK_TIMESTAMP + 333,
				path: 'Some parent folder/References.md',
				metadataFieldValue: 'direct metadata on file, tricky'
			} as FolderItemForSorting);
		})
		it('should correctly read direct metadata from File item (order by metadata set on group, no metadata name specified anywhere)', () => {
			// given
			const file: TFile = mockTFile('References', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
			const sortSpec: CustomSortSpec = {
				targetFoldersPaths: ['/'],
				groups: [{
					type: CustomSortGroupType.ExactPrefix,
					exactPrefix: 'Ref',
					order: CustomSortOrder.byMetadataFieldAlphabetical
				}],
				_mCache: {
					getCache: function (path: string): CachedMetadata | undefined {
						return {
							'Some parent folder/References.md': {
								frontmatter: {
									'sort-index-value': "direct metadata on file, under default name",
									position: MockedLoc
								}
							}
						}[path]
					}
				} as MetadataCache
			}

			// when
			const result = determineSortingGroup(file, sortSpec)

			// then
			expect(result).toEqual({
				groupIdx: 0,
				isFolder: false,
				sortString: "References.md",
				ctimeNewest: MOCK_TIMESTAMP + 222,
				ctimeOldest: MOCK_TIMESTAMP + 222,
				mtime: MOCK_TIMESTAMP + 333,
				path: 'Some parent folder/References.md',
				metadataFieldValue: 'direct metadata on file, under default name'
			} as FolderItemForSorting);
		})
	})

	it('should correctly apply priority group', () => {
		// given
		const file: TFile = mockTFile('Abcdef!', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
		const sortSpec: CustomSortSpec = {
			groups: [{
				filesOnly: true,
				order: CustomSortOrder.alphabetical,
				type: CustomSortGroupType.MatchAll
			}, {
				foldersOnly: true,
				order: CustomSortOrder.alphabetical,
				type: CustomSortGroupType.MatchAll
			}, {
				exactSuffix: "def!",
				priority: 2,
				order: CustomSortOrder.alphabetical,
				type: CustomSortGroupType.ExactSuffix
			}, {
				exactText: "Abcdef!",
				order: CustomSortOrder.alphabetical,
				priority: 3,
				type: CustomSortGroupType.ExactName
			}, {
				order: CustomSortOrder.alphabetical,
				type: CustomSortGroupType.Outsiders
			}],
			outsidersGroupIdx: 4,
			targetFoldersPaths: ['/'],
			priorityOrder: [3,2,0,1]
		}

		// when
		const result = determineSortingGroup(file, sortSpec)

		// then
		expect(result).toEqual({
			groupIdx: 3,
			isFolder: false,
			sortString: "Abcdef!.md",
			ctimeNewest: MOCK_TIMESTAMP + 222,
			ctimeOldest: MOCK_TIMESTAMP + 222,
			mtime: MOCK_TIMESTAMP + 333,
			path: 'Some parent folder/Abcdef!.md'
		});
	})
	it('should correctly recognize and apply combined group', () => {
		// given
		const file1: TFile = mockTFile('Hello :-) ha', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
		const file2: TFile = mockTFile('Hello World :-)', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
		const sortSpec: CustomSortSpec = {
			groups: [{
				exactSuffix: "def!",
				order: CustomSortOrder.alphabeticalReverse,
				type: CustomSortGroupType.ExactSuffix
			}, {
				exactPrefix: "Hello :-)",
				order: CustomSortOrder.alphabeticalReverse,
				type: CustomSortGroupType.ExactPrefix,
				combineWithIdx: 1
			}, {
				exactText: "Hello World :-)",
				order: CustomSortOrder.alphabeticalReverse,
				type: CustomSortGroupType.ExactName,
				combineWithIdx: 1
			}, {
				filesOnly: true,
				order: CustomSortOrder.alphabetical,
				type: CustomSortGroupType.MatchAll
			}, {
				foldersOnly: true,
				order: CustomSortOrder.alphabetical,
				type: CustomSortGroupType.MatchAll
			}, {
				order: CustomSortOrder.alphabetical,
				type: CustomSortGroupType.Outsiders
			}],
			outsidersGroupIdx: 5,
			targetFoldersPaths: ['/']
		}

		// when
		const result1 = determineSortingGroup(file1, sortSpec)
		const result2 = determineSortingGroup(file2, sortSpec)

		// then
		expect(result1).toEqual({
			groupIdx: 1, // Imposed by combined groups
			isFolder: false,
			sortString: "Hello :-) ha.md",
			ctimeNewest: MOCK_TIMESTAMP + 222,
			ctimeOldest: MOCK_TIMESTAMP + 222,
			mtime: MOCK_TIMESTAMP + 333,
			path: 'Some parent folder/Hello :-) ha.md'
		});
		expect(result2).toEqual({
			groupIdx: 1, // Imposed by combined groups
			isFolder: false,
			sortString: "Hello World :-).md",
			ctimeNewest: MOCK_TIMESTAMP + 222,
			ctimeOldest: MOCK_TIMESTAMP + 222,
			mtime: MOCK_TIMESTAMP + 333,
			path: 'Some parent folder/Hello World :-).md'
		});
	})
	it('should correctly recognize and apply combined group in connection with priorities', () => {
		// given
		const file: TFile = mockTFile('Hello :-)', 'md', 111, MOCK_TIMESTAMP + 222, MOCK_TIMESTAMP + 333);
		const sortSpec: CustomSortSpec = {
			groups: [{
				filesOnly: true,
				order: CustomSortOrder.alphabetical,
				type: CustomSortGroupType.MatchAll
			}, {
				foldersOnly: true,
				order: CustomSortOrder.alphabetical,
				type: CustomSortGroupType.MatchAll
			}, {
				exactSuffix: "def!",
				order: CustomSortOrder.alphabeticalReverse,
				type: CustomSortGroupType.ExactSuffix,
				combineWithIdx: 2
			}, {
				exactText: "Hello :-)",
				order: CustomSortOrder.alphabeticalReverse,
				type: CustomSortGroupType.ExactName,
				priority: 1,
				combineWithIdx: 2
			}, {
				order: CustomSortOrder.alphabetical,
				type: CustomSortGroupType.Outsiders
			}],
			outsidersGroupIdx: 4,
			priorityOrder: [3,0,1,2],
			targetFoldersPaths: ['/']
		}

		// when
		const result = determineSortingGroup(file, sortSpec)

		// then
		expect(result).toEqual({
			groupIdx: 2, // Imposed by combined groups
 			isFolder: false,
			sortString: "Hello :-).md",
			ctimeNewest: MOCK_TIMESTAMP + 222,
			ctimeOldest: MOCK_TIMESTAMP + 222,
			mtime: MOCK_TIMESTAMP + 333,
			path: 'Some parent folder/Hello :-).md'
		});
	})
})

describe('determineFolderDatesIfNeeded', () => {
	it('should not be triggered if not needed - sorting method does not require it', () => {
		// given
		const folder: TFolder = mockTFolderWithChildren('Test folder 1')
		const OUTSIDERS_GROUP_IDX = 0
		const sortSpec: CustomSortSpec = {
			targetFoldersPaths: ['/'],
			groups: [{
				type: CustomSortGroupType.Outsiders,
				order: CustomSortOrder.alphabetical
			}],
			outsidersGroupIdx: OUTSIDERS_GROUP_IDX
		}

		// when
		const result: FolderItemForSorting = determineSortingGroup(folder, sortSpec)
		determineFolderDatesIfNeeded([result], sortSpec)

		// then
		expect(result.ctimeOldest).toEqual(DEFAULT_FOLDER_CTIME)
		expect(result.ctimeNewest).toEqual(DEFAULT_FOLDER_CTIME)
		expect(result.mtime).toEqual(DEFAULT_FOLDER_CTIME)
	})
	it('should correctly determine dates, if triggered', () => {
		// given
		const folder: TFolder = mockTFolderWithChildren('Test folder 1')
		const OUTSIDERS_GROUP_IDX = 0
		const sortSpec: CustomSortSpec = {
			targetFoldersPaths: ['/'],
			groups: [{
				type: CustomSortGroupType.Outsiders,
				order: CustomSortOrder.byCreatedTimeReverseAdvanced
			}],
			outsidersGroupIdx: OUTSIDERS_GROUP_IDX
		}

		// when
		const result: FolderItemForSorting = determineSortingGroup(folder, sortSpec)
		determineFolderDatesIfNeeded([result], sortSpec)

		// then
		expect(result.ctimeOldest).toEqual(TIMESTAMP_OLDEST)
		expect(result.ctimeNewest).toEqual(TIMESTAMP_NEWEST)
		expect(result.mtime).toEqual(TIMESTAMP_NEWEST)
	})
})

describe('matchGroupRegex', () => {
	it( 'should correctly handle no match', () => {
		// given
		const regExpSpec: RegExpSpec = {
			regex: /a(b)c/i
		}
		const name: string = 'Abbc'

		// when
		const [matched, matchedGroup, entireMatch] = matchGroupRegex(regExpSpec, name)

		// then
		expect(matched).toBe(false)
		expect(matchedGroup).toBeUndefined()
		expect(entireMatch).toBeUndefined()
	})
	it('should correctly handle no matching group match and normalizer absent', () => {
		// given
		const regExpSpec: RegExpSpec = {
			regex: /ab+c/i
		}
		const name: string = 'Abbbc'

		// when
		const [matched, matchedGroup, entireMatch] = matchGroupRegex(regExpSpec, name)

		// then
		expect(matched).toBe(true)
		expect(matchedGroup).toBeUndefined()
		expect(entireMatch).toBe('Abbbc')
	})
	it('should correctly handle no matching group match and normalizer present', () => {
		// given
		const regExpSpec: RegExpSpec = {
			regex: /ab+c/i,
			normalizerFn: jest.fn()
		}
		const name: string = 'Abc'

		// when
		const [matched, matchedGroup, entireMatch] = matchGroupRegex(regExpSpec, name)

		// then
		expect(matched).toBe(true)
		expect(matchedGroup).toBeUndefined()
		expect(entireMatch).toBe('Abc')
		expect(regExpSpec.normalizerFn).not.toHaveBeenCalled()
	})
	it('should correctly handle matching group match and normalizer absent', () => {
		// given
		const regExpSpec: RegExpSpec = {
			regex: /a(b+)c/i
		}
		const name: string = 'Abbbc'

		// when
		const [matched, matchedGroup, entireMatch] = matchGroupRegex(regExpSpec, name)

		// then
		expect(matched).toBe(true)
		expect(matchedGroup).toBe('bbb')
		expect(entireMatch).toBe('Abbbc')
	})
	it('should correctly handle matching group match and normalizer present', () => {
		// given
		const regExpSpec: RegExpSpec = {
			regex: /a(b+)c/i,
			normalizerFn: jest.fn((s) => `>>${s}<<`)
		}
		const name: string = 'Abc'

		// when
		const [matched, matchedGroup, entireMatch] = matchGroupRegex(regExpSpec, name)

		// then
		expect(matched).toBe(true)
		expect(matchedGroup).toBe('>>b<<')
		expect(entireMatch).toBe('Abc')
		expect(regExpSpec.normalizerFn).toHaveBeenCalledTimes(1)
	})
})

const SORT_FIRST_GOES_EARLIER: number = -1
const SORT_FIRST_GOES_LATER: number = 1
const SORT_ITEMS_ARE_EQUAL: number = 0

describe('CustomSortOrder.byMetadataFieldAlphabetical', () => {
	it('should correctly order alphabetically when metadata on both items is present', () => {
		// given
		const itemA: Partial<FolderItemForSorting> = {
			metadataFieldValue: 'A'
		}
		const itemB: Partial<FolderItemForSorting> = {
			metadataFieldValue: 'B'
		}
		const sorter: SorterFn = Sorters[CustomSortOrder.byMetadataFieldAlphabetical]

		// when
		const result1: number = sorter(itemA as FolderItemForSorting, itemB as FolderItemForSorting)
		const result2: number = sorter(itemB as FolderItemForSorting, itemA as FolderItemForSorting)

		// then
		expect(result1).toBe(SORT_FIRST_GOES_EARLIER)
		expect(result2).toBe(SORT_FIRST_GOES_LATER)
	})
	it('should correctly fallback to alphabetical by name when metadata on both items is present and equal', () => {
		// given
		const itemA: Partial<FolderItemForSorting> = {
			metadataFieldValue: 'Aaa',
			sortString: 'n123'
		}
		const itemB: Partial<FolderItemForSorting> = {
			metadataFieldValue: 'Aaa',
			sortString: 'a123'
		}
		const sorter: SorterFn = Sorters[CustomSortOrder.byMetadataFieldAlphabetical]

		// when
		const result1: number = sorter(itemA as FolderItemForSorting, itemB as FolderItemForSorting)
		const result2: number = sorter(itemB as FolderItemForSorting, itemA as FolderItemForSorting)
		const result3: number = sorter(itemB as FolderItemForSorting, itemB as FolderItemForSorting)

		// then
		expect(result1).toBe(SORT_FIRST_GOES_LATER)
		expect(result2).toBe(SORT_FIRST_GOES_EARLIER)
		expect(result3).toBe(SORT_ITEMS_ARE_EQUAL)
	})
	it('should put the item with metadata earlier if the second one has no metadata ', () => {
		// given
		const itemA: Partial<FolderItemForSorting> = {
			metadataFieldValue: 'n159',
			sortString: 'n123'
		}
		const itemB: Partial<FolderItemForSorting> = {
			sortString: 'n123'
		}
		const sorter: SorterFn = Sorters[CustomSortOrder.byMetadataFieldAlphabetical]

		// when
		const result1: number = sorter(itemA as FolderItemForSorting, itemB as FolderItemForSorting)
		const result2: number = sorter(itemB as FolderItemForSorting, itemA as FolderItemForSorting)

		// then
		expect(result1).toBe(SORT_FIRST_GOES_EARLIER)
		expect(result2).toBe(SORT_FIRST_GOES_LATER)
	})
	it('should correctly fallback to alphabetical if no metadata on both items', () => {
		// given
		const itemA: Partial<FolderItemForSorting> = {
			sortString: 'ccc'
		}
		const itemB: Partial<FolderItemForSorting> = {
			sortString: 'ccc '
		}
		const sorter: SorterFn = Sorters[CustomSortOrder.byMetadataFieldAlphabetical]

		// when
		const result1: number = sorter(itemA as FolderItemForSorting, itemB as FolderItemForSorting)
		const result2: number = sorter(itemB as FolderItemForSorting, itemA as FolderItemForSorting)
		const result3: number = sorter(itemB as FolderItemForSorting, itemB as FolderItemForSorting)

		// then
		expect(result1).toBe(SORT_FIRST_GOES_EARLIER)
		expect(result2).toBe(SORT_FIRST_GOES_LATER)
		expect(result3).toBe(SORT_ITEMS_ARE_EQUAL)
	})
})

describe('CustomSortOrder.byMetadataFieldAlphabeticalReverse', () => {
	it('should correctly order alphabetically reverse when metadata on both items is present', () => {
		// given
		const itemA: Partial<FolderItemForSorting> = {
			metadataFieldValue: 'A'
		}
		const itemB: Partial<FolderItemForSorting> = {
			metadataFieldValue: 'B'
		}
		const sorter: SorterFn = Sorters[CustomSortOrder.byMetadataFieldAlphabeticalReverse]

		// when
		const result1: number = sorter(itemA as FolderItemForSorting, itemB as FolderItemForSorting)
		const result2: number = sorter(itemB as FolderItemForSorting, itemA as FolderItemForSorting)

		// then
		expect(result1).toBe(SORT_FIRST_GOES_LATER)
		expect(result2).toBe(SORT_FIRST_GOES_EARLIER)
	})
	it('should correctly fallback to alphabetical reverse by name when metadata on both items is present and equal', () => {
		// given
		const itemA: Partial<FolderItemForSorting> = {
			metadataFieldValue: 'Aaa',
			sortString: 'n123'
		}
		const itemB: Partial<FolderItemForSorting> = {
			metadataFieldValue: 'Aaa',
			sortString: 'a123'
		}
		const sorter: SorterFn = Sorters[CustomSortOrder.byMetadataFieldAlphabeticalReverse]

		// when
		const result1: number = sorter(itemA as FolderItemForSorting, itemB as FolderItemForSorting)
		const result2: number = sorter(itemB as FolderItemForSorting, itemA as FolderItemForSorting)
		const result3: number = sorter(itemB as FolderItemForSorting, itemB as FolderItemForSorting)

		// then
		expect(result1).toBe(SORT_FIRST_GOES_EARLIER)
		expect(result2).toBe(SORT_FIRST_GOES_LATER)
		expect(result3).toBe(SORT_ITEMS_ARE_EQUAL)
	})
	it('should put the item with metadata earlier if the second one has no metadata ', () => {
		// given
		const itemA: Partial<FolderItemForSorting> = {
			metadataFieldValue: '15',
			sortString: 'n123'
		}
		const itemB: Partial<FolderItemForSorting> = {
			sortString: 'n123'
		}
		const sorter: SorterFn = Sorters[CustomSortOrder.byMetadataFieldAlphabeticalReverse]

		// when
		const result1: number = sorter(itemA as FolderItemForSorting, itemB as FolderItemForSorting)
		const result2: number = sorter(itemB as FolderItemForSorting, itemA as FolderItemForSorting)

		// then
		expect(result1).toBe(SORT_FIRST_GOES_EARLIER)
		expect(result2).toBe(SORT_FIRST_GOES_LATER)
	})
	it('should correctly fallback to alphabetical reverse if no metadata on both items', () => {
		// given
		const itemA: Partial<FolderItemForSorting> = {
			sortString: 'ccc'
		}
		const itemB: Partial<FolderItemForSorting> = {
			sortString: 'ccc '
		}
		const sorter: SorterFn = Sorters[CustomSortOrder.byMetadataFieldAlphabeticalReverse]

		// when
		const result1: number = sorter(itemA as FolderItemForSorting, itemB as FolderItemForSorting)
		const result2: number = sorter(itemB as FolderItemForSorting, itemA as FolderItemForSorting)
		const result3: number = sorter(itemB as FolderItemForSorting, itemB as FolderItemForSorting)

		// then
		expect(result1).toBe(SORT_FIRST_GOES_LATER)
		expect(result2).toBe(SORT_FIRST_GOES_EARLIER)
		expect(result3).toBe(SORT_ITEMS_ARE_EQUAL)
	})
})
