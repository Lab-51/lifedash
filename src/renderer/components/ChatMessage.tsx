// === FILE PURPOSE ===
// Renders a single brainstorm chat message with role-based styling.
// AI responses use react-markdown with remark-gfm for full markdown support
// including tables, nested lists, links, images, task lists, and strikethrough.
//
// === DEPENDENCIES ===
// lucide-react, react-markdown, remark-gfm

import { useState } from 'react';
import { Lightbulb, Check, User, Bot, LayoutList } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { BrainstormMessage } from '../../shared/types';

interface ChatMessageProps {
  message: BrainstormMessage;
  onExportToIdea?: (messageId: string) => void;
  onExportToCard?: (messageId: string) => void;
}

function formatTimestamp(isoDate: string): string {
  return new Date(isoDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ChatMessage({ message, onExportToIdea, onExportToCard }: ChatMessageProps) {
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
      <div className="ml-auto max-w-[80%]">
        <div className="bg-primary-600/20 border border-primary-500/30 rounded-2xl rounded-br-sm p-3">
          <div className="flex items-center gap-2 mb-1">
            <User size={14} className="text-primary-400" />
            <span className="text-xs text-surface-500">You</span>
          </div>
          <div className="whitespace-pre-wrap text-sm text-surface-200">{message.content}</div>
          <div className="text-right mt-1">
            <span className="text-xs text-surface-600">{formatTimestamp(message.createdAt)}</span>
          </div>
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="mr-auto max-w-[80%] group">
      <div className="bg-surface-800 border border-surface-700 rounded-2xl rounded-bl-sm p-3">
        <div className="flex items-center gap-2 mb-1">
          <Bot size={14} className="text-primary-400" />
          <span className="text-xs text-surface-500">AI</span>
        </div>
        <div className="text-sm text-surface-200">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => <h1 className="text-lg font-bold mt-3 mb-1">{children}</h1>,
              h2: ({ children }) => <h2 className="text-base font-semibold mt-2 mb-1">{children}</h2>,
              h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1">{children}</h3>,
              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
              ul: ({ children }) => <ul className="list-disc pl-4 mb-2">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-4 mb-2">{children}</ol>,
              li: ({ children }) => <li className="mb-0.5">{children}</li>,
              code: ({ className, children, ...props }) => {
                const isInline = !className;
                return isInline ? (
                  <code className="bg-surface-700 px-1 py-0.5 rounded text-xs font-mono">{children}</code>
                ) : (
                  <code
                    className={`${className} block bg-surface-800 p-3 rounded-lg text-xs font-mono overflow-x-auto my-2`}
                    {...props}
                  >
                    {children}
                  </code>
                );
              },
              pre: ({ children }) => (
                <pre className="bg-surface-50 dark:bg-surface-950 border border-surface-200 dark:border-surface-700 rounded-lg overflow-x-auto my-2">
                  {children}
                </pre>
              ),
              a: ({ href, children }) => (
                <a href={href} className="text-primary-400 hover:underline" target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              ),
              table: ({ children }) => (
                <table className="border-collapse border border-surface-700 my-2 text-xs">{children}</table>
              ),
              th: ({ children }) => (
                <th className="border border-surface-700 px-2 py-1 bg-surface-800 font-semibold">{children}</th>
              ),
              td: ({ children }) => <td className="border border-surface-700 px-2 py-1">{children}</td>,
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 border-primary-500 pl-3 italic text-surface-400 my-2">
                  {children}
                </blockquote>
              ),
              hr: () => <hr className="border-surface-700 my-3" />,
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-surface-700/50">
          <div className="flex items-center gap-2">
            {onExportToIdea && (
              <button
                onClick={handleExport}
                className={`opacity-0 group-hover:opacity-100 flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-all ${
                  exported
                    ? 'text-green-400 bg-green-400/10'
                    : 'text-surface-400 hover:text-amber-400 hover:bg-surface-700'
                }`}
              >
                {exported ? <Check size={12} /> : <Lightbulb size={12} />}
                <span>{exported ? 'Saved!' : 'Save as Idea'}</span>
              </button>
            )}
            {onExportToCard && (
              <button
                onClick={handleExportToCard}
                className={`opacity-0 group-hover:opacity-100 flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-all ${
                  exportedCard
                    ? 'text-green-400 bg-green-400/10'
                    : 'text-surface-400 hover:text-primary-400 hover:bg-surface-700'
                }`}
              >
                {exportedCard ? <Check size={12} /> : <LayoutList size={12} />}
                <span>{exportedCard ? 'Saved!' : 'Save as Card'}</span>
              </button>
            )}
          </div>
          <span className="text-xs text-surface-600">{formatTimestamp(message.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}
