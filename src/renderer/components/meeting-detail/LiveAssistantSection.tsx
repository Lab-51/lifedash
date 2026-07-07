// === FILE PURPOSE ===
// Read-only Live Assistant conversation, shown in the session page after a
// meeting completes. Phase A is live-only (LIVE.1) — there is no post-meeting
// Q&A here, just a transcript of what was asked/answered during the recording.
// Uses its own local state (not meetingAgentStore) so it never shares state with
// a concurrently-open LiveModeOverlay chat for a different, still-recording meeting.

import { useEffect, useState } from 'react';
import ChatMessageModern from '../ChatMessageModern';
import { describeToolCall } from '../../utils/toolCallLabels';
import type { MeetingAgentMessage, BrainstormMessage } from '../../../shared/types';

function toBrainstormMessage(message: MeetingAgentMessage, content: string): BrainstormMessage {
  return {
    id: message.id,
    sessionId: message.threadId,
    role: message.role === 'user' ? 'user' : 'assistant',
    content,
    createdAt: message.createdAt,
  };
}

interface LiveAssistantSectionProps {
  meetingId: string;
}

export default function LiveAssistantSection({ meetingId }: LiveAssistantSectionProps) {
  const [messages, setMessages] = useState<MeetingAgentMessage[]>([]);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI
      .meetingAgentLoad(meetingId)
      .then((loaded) => {
        if (!cancelled) setMessages(loaded);
      })
      .catch(() => {
        // Best-effort — the conversation is a nice-to-have, not core meeting data.
      });
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  // Never used during this meeting — render nothing rather than an empty section.
  if (messages.length === 0) return null;

  return (
    <div className="mb-5">
      <h3 className="font-hud text-xs text-[var(--color-text-secondary)] mb-3">
        Live Assistant
        <span className="ml-2 text-surface-500">
          ({messages.length} message{messages.length !== 1 ? 's' : ''})
        </span>
      </h3>
      <div className="max-h-80 overflow-y-auto rounded-xl bg-surface-100/50 dark:bg-surface-950/50 border border-[var(--color-border)] p-4">
        {messages.map((message) => (
          <div key={message.id}>
            {message.content && <ChatMessageModern message={toBrainstormMessage(message, message.content)} />}
            {message.toolCalls && message.toolCalls.length > 0 && (
              <div className="flex flex-col gap-1 mb-4 -mt-2 px-1">
                {message.toolCalls.map((call, i) => (
                  <span key={call.id || i} className="text-[0.6875rem] font-data text-[var(--color-text-muted)]">
                    {describeToolCall(call)}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
