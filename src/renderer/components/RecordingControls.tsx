// === FILE PURPOSE ===
// Recording control panel -- start/stop recording with meeting title input.
// Shows a title input + start button when idle, or a stop button + elapsed
// timer when recording is active.
//
// === DEPENDENCIES ===
// react, lucide-react (Mic, Square, Loader2), recordingStore

import { useState } from 'react';
import { Mic, MicOff, Square, Loader2 } from 'lucide-react';
import { useRecordingStore } from '../stores/recordingStore';
import { MEETING_TEMPLATES } from '../../shared/types';
import type { MeetingTemplateType } from '../../shared/types';

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function RecordingControls() {
  const {
    isRecording, elapsed, error, starting, includeMic,
    startRecording, stopRecording, setIncludeMic,
  } = useRecordingStore();
  const [title, setTitle] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<MeetingTemplateType>('none');

  const handleStart = async () => {
    if (!title.trim()) return;
    await startRecording(title.trim(), undefined, selectedTemplate);
    setTitle('');
    setSelectedTemplate('none');
  };

  const handleStop = async () => {
    await stopRecording();
  };

  return (
    <div className="bg-surface-800 rounded-xl border border-surface-700 p-4">
      {!isRecording ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-surface-200">
            <Mic size={18} />
            <span className="text-sm font-medium">New Recording</span>
          </div>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Meeting title..."
            className="w-full bg-surface-900 border border-surface-600 rounded-lg px-3 py-2
                       text-sm text-surface-100 placeholder:text-surface-500
                       focus:outline-none focus:ring-1 focus:ring-primary-500"
            onKeyDown={(e) => e.key === 'Enter' && handleStart()}
            disabled={starting}
          />
          <select
            value={selectedTemplate}
            onChange={(e) => setSelectedTemplate(e.target.value as MeetingTemplateType)}
            className="w-full"
            disabled={starting}
          >
            {MEETING_TEMPLATES.map((t) => (
              <option key={t.type} value={t.type}>
                {t.name} — {t.description}
              </option>
            ))}
          </select>
          {selectedTemplate !== 'none' && (
            <div className="text-xs text-surface-400 space-y-0.5">
              <span className="font-medium">Suggested agenda:</span>
              {MEETING_TEMPLATES.find(t => t.type === selectedTemplate)?.agenda.map((item, i) => (
                <div key={i}>{'\u2022'} {item}</div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setIncludeMic(!includeMic)}
            disabled={starting}
            className={`flex items-center gap-2 w-full rounded-lg px-3 py-2 text-sm
                        border transition-colors
                        ${includeMic
                          ? 'bg-surface-800 border-primary-600 text-surface-200'
                          : 'bg-surface-900 border-surface-600 text-surface-500'}
                        disabled:opacity-50 disabled:cursor-not-allowed
                        hover:border-primary-500`}
          >
            {includeMic ? <Mic size={16} /> : <MicOff size={16} />}
            <span className="text-xs">
              {includeMic ? 'Microphone on' : 'Microphone off'}
            </span>
          </button>
          <button
            onClick={handleStart}
            disabled={!title.trim() || starting}
            className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500
                       disabled:bg-surface-700 disabled:text-surface-500
                       text-white rounded-lg px-3 py-2 text-sm font-medium
                       transition-colors"
          >
            {starting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Mic size={16} />
                Start Recording
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm font-medium text-red-400">Recording</span>
            </div>
            <span className="text-lg font-mono text-surface-200">
              {formatElapsed(elapsed)}
            </span>
          </div>
          <button
            onClick={handleStop}
            className="w-full flex items-center justify-center gap-2 bg-surface-700
                       hover:bg-surface-600 text-surface-200 rounded-lg px-3 py-2
                       text-sm font-medium transition-colors"
          >
            <Square size={14} />
            Stop Recording
          </button>
        </div>
      )}
      {error && (
        <p className="mt-2 text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}
