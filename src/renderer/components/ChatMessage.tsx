// === FILE PURPOSE ===
// Renders a single brainstorm chat message with role-based styling
// and lightweight markdown rendering for AI responses.
//
// === DEPENDENCIES ===
// lucide-react
//
// === LIMITATIONS ===
// - Markdown rendering is regex-based, not a full parser
// - Handles: headings, bullets, numbered lists, code blocks, inline code, bold, italic
// - Does NOT handle: nested lists, tables, images, links

import { useState } from 'react';
import { Lightbulb, Check, User, Bot } from 'lucide-react';
import type { BrainstormMessage } from '../../shared/types';

interface ChatMessageProps {
  message: BrainstormMessage;
  onExportToIdea?: (messageId: string) => void;
}

/**
 * Apply inline formatting: bold, italic, inline code.
 * Returns an array of React nodes.
 */
function formatInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Match inline code, bold, or italic
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    // Text before the match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith('`')) {
      // Inline code
      parts.push(
        <code key={key++} className="bg-surface-700 px-1 py-0.5 rounded text-xs font-mono">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('**')) {
      // Bold
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*')) {
      // Italic
      parts.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }

    lastIndex = match.index + token.length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

/**
 * Lightweight markdown renderer -- handles headings, lists, code blocks,
 * inline code, bold, italic. NOT a full parser.
 */
function renderMarkdown(content: string): React.ReactNode {
  // Split by code blocks (``` ... ```)
  const codeBlockRegex = /```(?:\w*)\n?([\s\S]*?)```/g;
  const segments: { type: 'text' | 'code'; content: string }[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: content.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'code', content: match[1] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    segments.push({ type: 'text', content: content.slice(lastIndex) });
  }

  const elements: React.ReactNode[] = [];
  let key = 0;

  for (const segment of segments) {
    if (segment.type === 'code') {
      elements.push(
        <pre key={key++} className="bg-surface-950 border border-surface-700 rounded-lg p-3 text-xs font-mono overflow-x-auto my-2">
          <code>{segment.content.trim()}</code>
        </pre>
      );
      continue;
    }

    // Process text segment line by line
    const lines = segment.content.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Empty line
      if (line.trim() === '') {
        elements.push(<div key={key++} className="h-2" />);
        i++;
        continue;
      }

      // Headings
      if (line.startsWith('### ')) {
        elements.push(
          <div key={key++} className="font-semibold text-surface-100 mt-3 mb-1 text-sm">
            {formatInline(line.slice(4))}
          </div>
        );
        i++;
        continue;
      }
      if (line.startsWith('## ')) {
        elements.push(
          <div key={key++} className="font-semibold text-surface-100 mt-3 mb-1">
            {formatInline(line.slice(3))}
          </div>
        );
        i++;
        continue;
      }

      // Bullet lists
      if (/^[-*] /.test(line.trim())) {
        const items: React.ReactNode[] = [];
        while (i < lines.length && /^[-*] /.test(lines[i].trim())) {
          items.push(
            <li key={key++}>{formatInline(lines[i].trim().slice(2))}</li>
          );
          i++;
        }
        elements.push(
          <ul key={key++} className="list-disc pl-4 space-y-0.5">{items}</ul>
        );
        continue;
      }

      // Numbered lists
      if (/^\d+\. /.test(line.trim())) {
        const items: React.ReactNode[] = [];
        while (i < lines.length && /^\d+\. /.test(lines[i].trim())) {
          const text = lines[i].trim().replace(/^\d+\.\s*/, '');
          items.push(
            <li key={key++}>{formatInline(text)}</li>
          );
          i++;
        }
        elements.push(
          <ol key={key++} className="list-decimal pl-4 space-y-0.5">{items}</ol>
        );
        continue;
      }

      // Regular paragraph
      elements.push(
        <p key={key++} className="my-0.5">{formatInline(line)}</p>
      );
      i++;
    }
  }

  return <>{elements}</>;
}

function formatTimestamp(isoDate: string): string {
  return new Date(isoDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ChatMessage({ message, onExportToIdea }: ChatMessageProps) {
  const [exported, setExported] = useState(false);

  const handleExport = () => {
    if (onExportToIdea && !exported) {
      onExportToIdea(message.id);
      setExported(true);
      setTimeout(() => setExported(false), 2000);
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
        <div className="text-sm text-surface-200">{renderMarkdown(message.content)}</div>
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-surface-700/50">
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
          <span className="text-xs text-surface-600">{formatTimestamp(message.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}
