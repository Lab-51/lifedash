// === FILE PURPOSE ===
// Displays card file attachments with add, open, and delete functionality.
// Files are opened with the OS default application.
//
// === DEPENDENCIES ===
// react, lucide-react, cardDetailStore
//
// === LIMITATIONS ===
// - No drag-and-drop file upload (uses file dialog)
// - No file preview (opens with OS app)
// - No file size limit enforcement

import { useState } from 'react';
import { Paperclip, File, FileText, FileCode, Image as ImageIcon, ExternalLink, Trash2, Plus } from 'lucide-react';
import { useCardDetailStore } from '../stores/cardDetailStore';

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getFileIcon(mimeType: string | null) {
  if (mimeType?.startsWith('image/')) return ImageIcon;
  if (mimeType === 'application/pdf') return FileText;
  if (mimeType?.startsWith('text/')) return FileCode;
  return File;
}

interface AttachmentsSectionProps {
  cardId: string;
}

function AttachmentsSection({ cardId }: AttachmentsSectionProps) {
  const selectedCardAttachments = useCardDetailStore(s => s.selectedCardAttachments);
  const addAttachment = useCardDetailStore(s => s.addAttachment);
  const deleteAttachment = useCardDetailStore(s => s.deleteAttachment);
  const openAttachment = useCardDetailStore(s => s.openAttachment);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleAdd = async () => {
    await addAttachment(cardId);
  };

  const handleDelete = async (id: string) => {
    await deleteAttachment(id);
    setConfirmDeleteId(null);
  };

  const handleOpen = async (filePath: string) => {
    await openAttachment(filePath);
  };

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <Paperclip size={14} className="text-surface-400" />
          <span className="text-sm text-surface-400">Attachments</span>
          {selectedCardAttachments.length > 0 && (
            <span className="bg-surface-800 text-surface-300 text-xs px-1.5 py-0.5 rounded-full ml-1.5">
              {selectedCardAttachments.length}
            </span>
          )}
        </div>
        <button
          onClick={handleAdd}
          className="inline-flex items-center gap-1 text-xs text-primary-400 hover:text-primary-300 transition-colors"
        >
          <Plus size={12} />
          Add File
        </button>
      </div>

      {/* Attachments list */}
      {selectedCardAttachments.length === 0 ? (
        <p className="text-sm text-surface-500 italic">
          No attachments. Click &apos;+ Add File&apos; to attach documents, images, or other files.
        </p>
      ) : (
        <div className="space-y-1.5">
          {selectedCardAttachments.map(att => {
            const Icon = getFileIcon(att.mimeType);
            return (
              <div
                key={att.id}
                className="bg-surface-800/50 rounded-lg px-3 py-2.5 flex items-center gap-3 group hover:bg-surface-800/80 transition-colors"
              >
                <Icon size={16} className="text-surface-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span
                    className="text-sm text-surface-200 truncate block max-w-[200px]"
                    title={att.fileName}
                  >
                    {att.fileName}
                  </span>
                  <span className="text-xs text-surface-500">
                    {formatFileSize(att.fileSize)} · {timeAgo(att.createdAt)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => handleOpen(att.filePath)}
                    className="inline-flex items-center gap-1 text-xs text-surface-400 hover:text-surface-200 transition-colors px-1.5 py-1"
                    title="Open with default app"
                  >
                    <ExternalLink size={12} />
                    Open
                  </button>
                  {confirmDeleteId === att.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDelete(att.id)}
                        className="text-xs text-red-400 hover:text-red-300 transition-colors px-1.5 py-1"
                      >
                        Delete?
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-xs text-surface-500 hover:text-surface-300 transition-colors px-1.5 py-1"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(att.id)}
                      className="text-surface-500 hover:text-surface-300 transition-colors p-1"
                      title="Delete attachment"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default AttachmentsSection;
