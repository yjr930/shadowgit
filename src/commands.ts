import * as vscode from 'vscode';
import { shadowGit, CommitInfo } from './shadowGit';
import { timelineView, CommitTreeItem } from './timeline';

export function registerCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('shadowgit.init', async () => {
            const success = await shadowGit.initRepo();
            if (success) {
                await timelineView.refresh();
            }
        }),

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

        vscode.commands.registerCommand('shadowgit.cleanLargeFiles', async () => {
            const toClean = await shadowGit.getTrackedByExclude();

            if (toClean.length === 0) {
                vscode.window.showInformationMessage('没有需要清理的内容（exclude 中的路径均未在历史中追踪）');
                return;
            }

            const sizeInfo = await shadowGit.getRepoSize();
            const confirm = await vscode.window.showWarningMessage(
                `检测到 ${toClean.length} 个已排除但仍在历史中的路径:\n${toClean.join(', ')}\n\n当前仓库大小: ${sizeInfo}\n将从所有历史 commit 中移除，此操作不可撤销。`,
                { modal: true },
                '执行清理',
                '取消'
            );

            if (confirm !== '执行清理') return;

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Shadow Git: 清理历史',
                    cancellable: false
                },
                async (progress) => {
                    const result = await shadowGit.cleanExcludedFromHistory(
                        (msg) => progress.report({ message: msg })
                    );
                    if (result.success && result.cleaned.length > 0) {
                        await timelineView.refresh();
                        vscode.window.showInformationMessage(
                            `已清理: ${result.cleaned.join(', ')}。仓库大小: ${result.size}`
                        );
                    } else if (result.success) {
                        vscode.window.showInformationMessage('无需清理');
                    } else {
                        const detail = result.error ? `\n${result.error.slice(0, 200)}` : '';
                        vscode.window.showErrorMessage(`清理失败: ${detail || '未知错误，请查看开发者控制台'}`);
                    }
                }
            );
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
