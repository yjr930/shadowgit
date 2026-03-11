import * as vscode from 'vscode';
import { shadowGit, CommitInfo } from './shadowGit';

export class CommitTreeItem extends vscode.TreeItem {
    constructor(
        public readonly commit: CommitInfo,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
    ) {
        const icon = commit.isAgent ? '🤖' : '👤';
        const label = `${icon} ${commit.message}`;
        
        super(label, collapsibleState);
        
        this.contextValue = 'commit';
        this.description = this.formatDate(commit.date);
        this.tooltip = `${commit.message}\n\nHash: ${commit.hash}\nAuthor: ${commit.author} <${commit.email}>`;
        
        this.command = {
            command: 'shadowgit.showCommitDiff',
            title: 'Show Diff',
            arguments: [this.commit]
        };
    }

    private formatDate(date: Date): string {
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (days === 0) {
            return `Today ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        } else if (days === 1) {
            return `Yesterday ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        } else if (days < 7) {
            return `${days} days ago`;
        } else {
            return date.toLocaleDateString();
        }
    }
}

class TimelineViewProvider implements vscode.TreeDataProvider<CommitTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<CommitTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    
    private commits: CommitInfo[] = [];

    async refresh(): Promise<void> {
        this.commits = [];
        this.commits = await shadowGit.getLog();
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: CommitTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(): Promise<CommitTreeItem[]> {
        return this.commits.map(commit => new CommitTreeItem(commit));
    }
}

export class TimelineView {
    private provider: TimelineViewProvider;
    private view: vscode.TreeView<CommitTreeItem>;

    constructor() {
        this.provider = new TimelineViewProvider();
        this.view = vscode.window.createTreeView<CommitTreeItem>('shadowgit-timeline', {
            treeDataProvider: this.provider
        });
        
        this.setupSelectionHandler();
    }

    private setupSelectionHandler(): void {
        this.view.onDidChangeSelection(async (event) => {
            if (event.selection.length > 0) {
                const item = event.selection[0];
                if (item instanceof CommitTreeItem) {
                    const { diffPanel } = await import('./diffPanel');
                    await diffPanel.showCommitDiff(item.commit);
                }
            }
        });
    }

    refresh(): void {
        this.provider.refresh();
    }

    dispose(): void {
        this.view.dispose();
    }
}

export const timelineView = new TimelineView();
