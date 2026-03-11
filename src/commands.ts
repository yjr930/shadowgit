import * as vscode from 'vscode';
import { shadowGit, CommitInfo } from './shadowGit';
import { timelineView, CommitTreeItem } from './timeline';

export function registerCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('shadowgit.showTimeline', () => {
            timelineView.refresh();
            vscode.window.showInformationMessage('Timeline refreshed');
        }),

        vscode.commands.registerCommand('shadowgit.showCommitDiff', async (commit: CommitInfo) => {
            const { diffPanel } = await import('./diffPanel');
            await diffPanel.showCommitDiff(commit);
        }),

        vscode.commands.registerCommand('shadowgit.checkoutToCommit', async (item: CommitTreeItem) => {
            const response = await vscode.window.showWarningMessage(
                `Checkout to this version?`,
                { modal: true },
                'Checkout',
                'Cancel'
            );

            if (response === 'Checkout') {
                const success = await shadowGit.checkoutToCommit(item.commit.hash);
                if (success) {
                    vscode.window.showInformationMessage('Successfully checked out');
                    await timelineView.refresh();
                    await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
                } else {
                    vscode.window.showErrorMessage('Failed to checkout');
                }
            }
        }),

        vscode.commands.registerCommand('shadowgit.truncateHistory', async (item: CommitTreeItem) => {
            const response = await vscode.window.showWarningMessage(
                `Delete all history before "${item.commit.message}"?\nThis cannot be undone.`,
                { modal: true },
                'Delete',
                'Cancel'
            );

            if (response === 'Delete') {
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Cleaning history',
                        cancellable: false
                    },
                    async (progress) => {
                        progress.report({ message: 'Rewriting commits...' });
                        const success = await shadowGit.truncateHistoryBefore(item.commit.hash);
                        if (success) {
                            progress.report({ message: 'Refreshing timeline...' });
                            await timelineView.refresh();
                            vscode.window.showInformationMessage('History before this commit has been deleted');
                        } else {
                            vscode.window.showErrorMessage('Failed to delete history');
                        }
                    }
                );
            }
        })
    );
}
