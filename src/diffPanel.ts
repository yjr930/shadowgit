import * as vscode from 'vscode';
import { shadowGit, CommitInfo } from './shadowGit';
import { createHighlighter } from 'shiki';

let shikiInstance: any = null;
let shikiLoading: Promise<any> | null = null;

async function ensureHighlighter(): Promise<any> {
    if (shikiInstance) return shikiInstance;
    if (shikiLoading) return shikiLoading;
    
    shikiLoading = (async () => {
        shikiInstance = await createHighlighter({
            themes: ['dark-plus', 'light-plus'],
            langs: ['javascript', 'typescript', 'python', 'rust', 'go', 'java', 'c', 'cpp', 'css', 'html', 'json', 'yaml', 'bash', 'sql', 'markdown']
        });
        return shikiInstance;
    })();
    
    return shikiLoading;
}

export function preloadHighlighter(): void {
    ensureHighlighter().catch(err => console.error('[ShadowGit] Failed to preload shiki:', err));
}

const LANG_MAP: Record<string, string> = {
    'js': 'javascript', 'mjs': 'javascript', 'cjs': 'javascript',
    'ts': 'typescript', 'mts': 'typescript', 'cts': 'typescript',
    'jsx': 'jsx', 'tsx': 'tsx',
    'py': 'python', 'rb': 'ruby', 'rs': 'rust', 'go': 'go',
    'java': 'java', 'c': 'c', 'cpp': 'cpp', 'cc': 'cpp',
    'h': 'c', 'hpp': 'cpp', 'hh': 'cpp',
    'css': 'css', 'scss': 'scss', 'less': 'css',
    'html': 'html', 'htm': 'html',
    'json': 'json', 'jsonc': 'json',
    'xml': 'xml', 'svg': 'xml',
    'md': 'markdown', 'mdx': 'markdown',
    'yaml': 'yaml', 'yml': 'yaml',
    'sh': 'bash', 'bash': 'bash', 'zsh': 'bash',
    'sql': 'sql',
};

function getLanguageId(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    return LANG_MAP[ext] || 'text';
}

function getThemeName(): string {
    const kind = vscode.window.activeColorTheme.kind;
    return (kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight)
        ? 'light-plus' : 'dark-plus';
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function tokenizeToHtmlLines(highlighter: any, code: string, lang: string, theme: string): string[] {
    if (!code) return [''];
    try {
        const loadedLangs: string[] = highlighter.getLoadedLanguages();
        const effectiveLang = loadedLangs.includes(lang) ? lang : 'text';
        const result = highlighter.codeToTokens(code, { lang: effectiveLang, theme });
        return result.tokens.map((lineTokens: any[]) =>
            lineTokens.map((token: any) => {
                const escaped = escapeHtml(token.content);
                return token.color ? `<span style="color:${token.color}">${escaped}</span>` : escaped;
            }).join('')
        );
    } catch {
        return code.split('\n').map((line: string) => escapeHtml(line));
    }
}

export class DiffPanel {
    private panel: vscode.WebviewPanel | undefined;
    private currentCommit: CommitInfo | undefined;

    async showCommitDiff(commit: CommitInfo): Promise<void> {
        this.currentCommit = commit;

        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.One);
            this.panel.title = `Diff: ${commit.message}`;
            
            this.panel.webview.postMessage({ type: 'loading', value: true });
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'shadowgit-diff',
                `Diff: ${commit.message}`,
                vscode.ViewColumn.One,
                { enableScripts: true, retainContextWhenHidden: true }
            );
            this.panel.onDidDispose(() => { this.panel = undefined; });
            this.panel.webview.html = this.generateEmptyHtml();
        }

        const [diffData, highlighter] = await Promise.all([
            shadowGit.getCommitDiff(commit.hash),
            ensureHighlighter()
        ]);
        
        const theme = getThemeName();
        const editorConfig = vscode.workspace.getConfiguration('editor');
        const fontSettings = {
            fontSize: editorConfig.get<number>('fontSize', 14),
            fontFamily: editorConfig.get<string>('fontFamily', "'Consolas', 'Courier New', monospace"),
            lineHeight: editorConfig.get<number>('lineHeight', 0),
        };
        if (fontSettings.lineHeight <= 0) {
            fontSettings.lineHeight = Math.round(fontSettings.fontSize * 1.5);
        }

        this.panel.webview.html = generateHtml(commit, diffData.files, highlighter, theme, fontSettings);
    }

    private generateEmptyHtml(): string {
        return `<!DOCTYPE html>
<html><head><style>
    body { margin: 0; padding: 0; background: transparent; }
</style></head><body></body></html>`;
    }

    dispose(): void {
        if (this.panel) {
            this.panel.dispose();
            this.panel = undefined;
        }
    }
}

function generateHtml(
    commit: CommitInfo,
    files: { path: string; status: string; oldContent: string; newContent: string }[],
    highlighter: any,
    theme: string,
    font: { fontSize: number; fontFamily: string; lineHeight: number }
): string {
    const themeObj = highlighter.getTheme(theme);
    const bg: string = themeObj.bg;
    const fg: string = themeObj.fg;
    const isLight = theme === 'light-plus';

    const lineNumColor = isLight ? '#6e7681' : '#858585';
    const headerBg = isLight ? '#f6f8fa' : '#2d2d2d';
    const headerHoverBg = isLight ? '#dfe2e5' : '#3a3d41';
    const borderColor = isLight ? '#d0d7de' : '#444';
    const accentColor = isLight ? '#0969da' : '#4ec9b0';
    const addedBg = isLight ? 'rgba(46,160,67,0.15)' : 'rgba(46,160,67,0.2)';
    const removedBg = isLight ? 'rgba(248,81,73,0.15)' : 'rgba(248,81,73,0.2)';
    const changedBg = isLight ? 'rgba(187,128,9,0.15)' : 'rgba(187,128,9,0.2)';

    const filesHtml = files.map(file => {
        const statusLabel = file.status === 'A' ? '(new)' : file.status === 'D' ? '(deleted)' : '';
        const lang = getLanguageId(file.path);
        const oldTokenized = tokenizeToHtmlLines(highlighter, file.oldContent, lang, theme);
        const newTokenized = tokenizeToHtmlLines(highlighter, file.newContent, lang, theme);
        const oldLines = file.oldContent.split('\n');
        const newLines = file.newContent.split('\n');
        const maxLines = Math.max(oldLines.length, newLines.length);

        let rows = '';
        for (let i = 0; i < maxLines; i++) {
            const oldLine = i < oldLines.length ? oldLines[i] : '';
            const newLine = i < newLines.length ? newLines[i] : '';
            const oldHtml = i < oldTokenized.length ? oldTokenized[i] : '';
            const newHtml = i < newTokenized.length ? newTokenized[i] : '';

            let oldClass = '';
            let newClass = '';
            if (oldLine !== newLine) {
                if (oldLine === '') { newClass = 'added'; }
                else if (newLine === '') { oldClass = 'removed'; }
                else { oldClass = 'changed'; newClass = 'changed'; }
            }

            rows += `<tr>
                <td class="ln">${i + 1}</td>
                <td class="code ${oldClass}"><code>${oldHtml}</code></td>
                <td class="ln">${i + 1}</td>
                <td class="code ${newClass}"><code>${newHtml}</code></td>
            </tr>`;
        }

        return `<div class="file-block">
            <div class="file-header" onclick="toggleFile(this)">
                <span class="toggle-icon">▼</span>
                <span class="file-path">${escapeHtml(file.path)}</span>
                <span class="file-status">${statusLabel}</span>
            </div>
            <div class="file-content">
                <table><tbody>${rows}</tbody></table>
            </div>
        </div>`;
    }).join('');

    return `<!DOCTYPE html>
<html><head><style>
    body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: ${font.fontSize}px;
        margin: 0; padding: 10px;
        background: ${bg}; color: ${fg};
    }
    .commit-info {
        padding: 10px;
        background: ${headerBg};
        border-radius: 4px;
        margin-bottom: 15px;
    }
    .commit-message { font-size: ${font.fontSize + 2}px; font-weight: bold; margin-bottom: 5px; }
    .commit-meta { font-size: ${font.fontSize - 2}px; color: ${lineNumColor}; }
    .file-block {
        margin-bottom: 10px;
        border: 1px solid ${borderColor};
        border-radius: 4px;
        overflow: hidden;
    }
    .file-header {
        display: flex; align-items: center;
        padding: 8px 10px;
        background: ${headerBg};
        cursor: pointer; user-select: none;
    }
    .file-header:hover { background: ${headerHoverBg}; }
    .toggle-icon {
        margin-right: 8px; font-size: 10px;
        transition: transform 0.2s;
    }
    .file-header.collapsed .toggle-icon { transform: rotate(-90deg); }
    .file-header.collapsed + .file-content { display: none; }
    .file-path { flex: 1; font-weight: 500; }
    .file-status { color: ${accentColor}; font-size: ${font.fontSize - 2}px; margin-left: 10px; }
    table {
        width: 100%; border-collapse: collapse;
        font-family: ${font.fontFamily};
        font-size: ${font.fontSize}px;
        line-height: ${font.lineHeight}px;
        table-layout: fixed;
    }
    td { padding: 0; white-space: pre; overflow: hidden; }
    .ln {
        width: 40px; min-width: 40px; max-width: 40px;
        text-align: right; color: ${lineNumColor};
        background: ${bg}; padding: 0 8px;
        user-select: none; vertical-align: top;
    }
    .code {
        width: 50%; padding: 0 8px;
        white-space: pre-wrap; word-break: break-all;
    }
    .code code {
        font-family: ${font.fontFamily};
        font-size: ${font.fontSize}px;
        background: transparent; padding: 0;
    }
    .added { background: ${addedBg}; }
    .removed { background: ${removedBg}; }
    .changed { background: ${changedBg}; }
</style></head>
<body>
    <div class="commit-info">
        <div class="commit-message">${escapeHtml(commit.message)}</div>
        <div class="commit-meta">${escapeHtml(commit.author)} • ${commit.date.toLocaleString()}</div>
    </div>
    ${filesHtml}
    <script>function toggleFile(h){h.classList.toggle('collapsed');}</script>
</body></html>`;
}

export const diffPanel = new DiffPanel();
