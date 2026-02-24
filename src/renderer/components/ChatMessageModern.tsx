// === FILE PURPOSE ===
// Modern Chat Message Component
// Enhanced styling for user and AI messages in the modern design system.

import { useState } from 'react';
import { Lightbulb, Check, User, Bot, LayoutList, Copy } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { BrainstormMessage } from '../../shared/types';

interface ChatMessageModernProps {
    message: BrainstormMessage;
    onExportToIdea?: (messageId: string) => void;
    onExportToCard?: (messageId: string) => void;
}

function formatTimestamp(isoDate: string): string {
    return new Date(isoDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ChatMessageModern({ message, onExportToIdea, onExportToCard }: ChatMessageModernProps) {
    const [exported, setExported] = useState(false);
    const [exportedCard, setExportedCard] = useState(false);

    const handleExport = () => {
        if (onExportToIdea && !exported) {
            onExportToIdea(message.id);
            setExported(true);
            setTimeout(() => setExported(false), 2000);
        }
    };

    const handleExportToCard = () => {
        if (onExportToCard && !exportedCard) {
            onExportToCard(message.id);
            setExportedCard(true);
            setTimeout(() => setExportedCard(false), 2000);
        }
    };

    if (message.role === 'user') {
        return (
            <div className="flex justify-end mb-4">
                <div className="max-w-[85%]">
                    <div className="flex items-center justify-end gap-2 mb-1 px-1">
                        <span className="text-[10px] font-hud text-[var(--color-text-muted)]">You</span>
                        <span className="font-data text-[10px] text-[var(--color-text-muted)]">{formatTimestamp(message.createdAt)}</span>
                    </div>
                    <div className="bg-[var(--color-accent-muted)] text-[var(--color-accent)] rounded-2xl rounded-tr-sm px-4 py-3 shadow-md border border-[var(--color-border-accent)]">
                        <div className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</div>
                    </div>
                </div>
            </div>
        );
    }

    // Assistant message
    return (
        <div className="flex justify-start mb-6 group">
            <div className="max-w-[90%] w-full">
                <div className="flex items-center gap-2 mb-1 px-1">
                    <div className="w-5 h-5 rounded-full bg-[var(--color-accent-muted)] border border-[var(--color-border-accent)] flex items-center justify-center shadow-sm">
                        <Bot size={12} className="text-[var(--color-accent)]" />
                    </div>
                    <span className="text-[10px] font-hud text-[var(--color-text-muted)]">AI Assistant</span>
                    <span className="font-data text-[10px] text-[var(--color-text-muted)]">{formatTimestamp(message.createdAt)}</span>
                </div>

                <div className="hud-panel rounded-2xl rounded-tl-sm p-5">
                    <div className="text-sm text-surface-800 dark:text-surface-200 leading-relaxed prose prose-sm dark:prose-invert max-w-none">
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                                h1: ({ children }) => <h1 className="text-lg font-bold mt-4 mb-2 first:mt-0 text-surface-900 dark:text-surface-100">{children}</h1>,
                                h2: ({ children }) => <h2 className="text-base font-bold mt-3 mb-2 text-surface-900 dark:text-surface-100">{children}</h2>,
                                h3: ({ children }) => <h3 className="text-sm font-bold mt-3 mb-1 text-surface-900 dark:text-surface-100">{children}</h3>,
                                p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
                                ul: ({ children }) => <ul className="list-disc pl-4 mb-3 space-y-1 marker:text-surface-400">{children}</ul>,
                                ol: ({ children }) => <ol className="list-decimal pl-4 mb-3 space-y-1 marker:text-surface-400">{children}</ol>,
                                li: ({ children }) => <li className="pl-1">{children}</li>,
                                code: ({ className, children, ...props }) => {
                                    const isInline = !className;
                                    return isInline
                                        ? <code className="bg-surface-100 dark:bg-surface-800 px-1.5 py-0.5 rounded text-xs font-mono text-primary-600 dark:text-primary-400 font-semibold border border-surface-200 dark:border-surface-700">{children}</code>
                                        : <code className={`${className} block bg-surface-50 dark:bg-surface-950 border border-surface-200 dark:border-surface-800 p-3 rounded-lg text-xs font-mono overflow-x-auto my-3`} {...props}>{children}</code>;
                                },
                                pre: ({ children }) => <pre className="not-prose bg-transparent p-0 m-0">{children}</pre>,
                                a: ({ href, children }) => <a href={href} className="text-primary-600 dark:text-primary-400 hover:underline font-medium" target="_blank" rel="noopener noreferrer">{children}</a>,
                                blockquote: ({ children }) => <blockquote className="border-l-4 border-primary-200 dark:border-surface-700 pl-4 italic text-surface-500 my-3">{children}</blockquote>,
                                hr: () => <hr className="border-surface-200 dark:border-surface-800 my-4" />,
                                table: ({ children }) => <div className="overflow-x-auto my-3"><table className="border-collapse border border-surface-200 dark:border-surface-700 w-full text-xs">{children}</table></div>,
                                th: ({ children }) => <th className="border border-surface-200 dark:border-surface-700 px-3 py-2 bg-surface-50 dark:bg-surface-800 font-semibold text-left">{children}</th>,
                                td: ({ children }) => <td className="border border-surface-200 dark:border-surface-700 px-3 py-2">{children}</td>,
                            }}
                        >
                            {message.content}
                        </ReactMarkdown>
                    </div>

                    {/* Action Bar */}
                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-surface-100 dark:border-surface-800">
                        <div className="flex items-center gap-2">
                            {onExportToIdea && (
                                <button
                                    onClick={handleExport}
                                    className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-all border ${exported
                                        ? 'text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-900 dark:text-emerald-400'
                                        : 'text-surface-500 border-transparent hover:bg-surface-50 dark:hover:bg-surface-800 hover:text-amber-600 dark:hover:text-amber-400'
                                        }`}
                                >
                                    {exported ? <Check size={14} /> : <Lightbulb size={14} />}
                                    <span>{exported ? 'Idea Saved' : 'Save Idea'}</span>
                                </button>
                            )}
                            {onExportToCard && (
                                <button
                                    onClick={handleExportToCard}
                                    className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-all border ${exportedCard
                                        ? 'text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-900 dark:text-emerald-400'
                                        : 'text-surface-500 border-transparent hover:bg-surface-50 dark:hover:bg-surface-800 hover:text-primary-600 dark:hover:text-primary-400'
                                        }`}
                                >
                                    {exportedCard ? <Check size={14} /> : <LayoutList size={14} />}
                                    <span>{exportedCard ? 'Card Created' : 'Create Card'}</span>
                                </button>
                            )}
                        </div>

                        <button
                            onClick={() => navigator.clipboard.writeText(message.content)}
                            className="p-1.5 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 rounded-md hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
                            title="Copy to clipboard"
                        >
                            <Copy size={14} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
