import { App, MarkdownPostProcessorContext, Modal, Notice, Plugin } from "obsidian";
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import {
	DEFAULT_SETTINGS,
	PandocFencedDivsPluginSettings,
	PandocFencedDivsPluginSettingTab,
} from "./settings";

interface FencedDivBlock {
	startLine: number;
	endLine: number;
	className: string;
}

function parseBlocks(text: string): FencedDivBlock[] {
	const lines = text.split('\n');
	const blocks: FencedDivBlock[] = [];
	
	interface OpenBlock {
		startLine: number;
		className: string;
	}
	const stack: OpenBlock[] = [];
	
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) continue;
		const matchStart = line.match(/^:::\s+([a-zA-Z0-9_\-]+)/);
		if (matchStart && matchStart[1]) {
			stack.push({
				startLine: i,
				className: matchStart[1]
			});
			continue;
		}
		
		const matchEnd = line.match(/^:::\s*$/);
		if (matchEnd && stack.length > 0) {
			const currentBlock = stack.pop()!;
			blocks.push({
				startLine: currentBlock.startLine,
				endLine: i,
				className: currentBlock.className
			});
		}
	}
	
	while (stack.length > 0) {
		const currentBlock = stack.pop()!;
		blocks.push({
			startLine: currentBlock.startLine,
			endLine: lines.length - 1,
			className: currentBlock.className
		});
	}
	
	return blocks;
}

function hideRawTextSafely(el: HTMLElement, startClass: string | null, isEnd: boolean) {
	const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
	
	let node: Node | null;
	const nodesToProcess: Text[] = [];
	while ((node = walker.nextNode())) {
		nodesToProcess.push(node as Text);
	}

	for (const textNode of nodesToProcess) {
		let text = textNode.textContent || "";
		
		if (startClass) {
			const startRegex = new RegExp(`:::\\s*${startClass}`);
			const match = text.match(startRegex);
			if (match) {
				const index = match.index!;
				const before = text.substring(0, index);
				const after = text.substring(index + match[0].length);
				
				const parent = textNode.parentNode;
				if (!parent) continue;
				
				if (before) parent.insertBefore(document.createTextNode(before), textNode);
				
				const hiddenSpan = document.createElement("span");
				hiddenSpan.className = "pandoc-fenced-div-raw-text";
				hiddenSpan.textContent = match[0];
				parent.insertBefore(hiddenSpan, textNode);
				
				if (after) {
					const afterNode = document.createTextNode(after);
					parent.insertBefore(afterNode, textNode);
					textNode.textContent = after; 
					text = after;
				} else {
					textNode.textContent = "";
					text = "";
				}
				startClass = null;
			}
		}
		
		if (isEnd) {
			const idx = text.lastIndexOf(":::");
			if (idx !== -1) {
				const before = text.substring(0, idx);
				const after = text.substring(idx + 3);
				
				const parent = textNode.parentNode;
				if (!parent) continue;
				
				if (before) parent.insertBefore(document.createTextNode(before), textNode);
				
				const hiddenSpan = document.createElement("span");
				hiddenSpan.className = "pandoc-fenced-div-raw-text";
				hiddenSpan.textContent = ":::";
				parent.insertBefore(hiddenSpan, textNode);
				
				if (after) {
					textNode.textContent = after;
				} else {
					textNode.textContent = "";
				}
				isEnd = false;
			}
		}
	}
	
	el.querySelectorAll(".pandoc-fenced-div-raw-text").forEach(span => {
		const next = span.nextSibling;
		if (next && next.nodeName === "BR") {
			(next as HTMLElement).style.display = "none";
		}
		const prev = span.previousSibling;
		if (prev && prev.nodeName === "BR") {
			(prev as HTMLElement).style.display = "none";
		}
		const parent = span.parentElement;
		if (parent && parent.nodeName === "P") {
			if (!parent.innerText.trim() && Array.from(parent.children).every(c => c.tagName === "SPAN" || c.tagName === "BR" || (c as HTMLElement).style.display === "none")) {
				parent.style.display = "none";
			}
		}
	});
}

const fencedDivMark = Decoration.mark({ class: "pandoc-fenced-div-editor-mark" });
const fencedDivLine = Decoration.line({ class: "pandoc-fenced-div-editor-line" });

export const fencedDivViewPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = this.buildDecorations(view);
		}

		update(update: ViewUpdate) {
			if (update.docChanged || update.viewportChanged) {
				this.decorations = this.buildDecorations(update.view);
			}
		}

		buildDecorations(view: EditorView): DecorationSet {
			const builder = new RangeSetBuilder<Decoration>();
			const doc = view.state.doc;
			let depth = 0;
			
			for (let i = 1; i <= doc.lines; i++) {
				const line = doc.line(i);
				const lineText = line.text;
				
				const matchStart = lineText.match(/^:::\s+([a-zA-Z0-9_\-]+)/);
				const matchEnd = lineText.match(/^:::\s*$/);
				
				if (matchStart && matchStart[1]) {
					if (depth > 0) {
						builder.add(line.from, line.from, fencedDivLine);
					}
					
					const startOffset = lineText.indexOf(matchStart[1]);
					builder.add(line.from + startOffset, line.from + startOffset + matchStart[1].length, fencedDivMark);
					
					depth++;
				} else if (matchEnd && depth > 0) {
					depth--;
					if (depth > 0) {
						builder.add(line.from, line.from, fencedDivLine);
					}
				} else {
					if (depth > 0) {
						builder.add(line.from, line.from, fencedDivLine);
					}
				}
			}
			
			return builder.finish();
		}
	},
	{
		decorations: (v) => v.decorations,
	}
);

export default class PandocFencedDivsPlugin extends Plugin {
	settings: PandocFencedDivsPluginSettings;

	async onload() {
		await this.loadSettings();

		this.registerEditorExtension(fencedDivViewPlugin);

		this.registerMarkdownPostProcessor((el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
			const info = ctx.getSectionInfo(el);
			if (!info) {
				const text = el.innerText || "";
				const matchStart = text.match(/^:::\s+([a-zA-Z0-9_\-]+)/);
				const matchEnd = text.match(/:::\s*$/);
				if (matchStart && matchStart[1] && matchEnd && text.trim().startsWith(":::") && text.trim().endsWith(":::")) {
					el.classList.add("pandoc-fenced-div-part", "pandoc-fenced-div-single");
					el.setAttribute("data-div-class", matchStart[1]);
					hideRawTextSafely(el, matchStart[1], true);
				}
				return;
			}

			const blocks = parseBlocks(info.text);
			
			for (const block of blocks) {
				const isStart = info.lineStart <= block.startLine && info.lineEnd >= block.startLine;
				const isEnd = info.lineStart <= block.endLine && info.lineEnd >= block.endLine;
				const isMiddle = info.lineStart > block.startLine && info.lineEnd < block.endLine;
		
				if (!isStart && !isEnd && !isMiddle) continue;
		
				el.classList.add("pandoc-fenced-div-part");
				if (isStart && isEnd) {
					el.classList.add("pandoc-fenced-div-single");
					el.setAttribute("data-div-class", block.className);
				} else if (isStart) {
					el.classList.add("pandoc-fenced-div-start");
					el.setAttribute("data-div-class", block.className);
				} else if (isEnd) {
					el.classList.add("pandoc-fenced-div-end");
				} else if (isMiddle) {
					el.classList.add("pandoc-fenced-div-middle");
				}
		
				hideRawTextSafely(el, isStart ? block.className : null, isEnd);
			}
		});

		this.addSettingTab(
			new PandocFencedDivsPluginSettingTab(this.app, this),
		);
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<PandocFencedDivsPluginSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
