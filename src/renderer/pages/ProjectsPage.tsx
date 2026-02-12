// === FILE PURPOSE ===
// Placeholder page for the Projects view (default route).
// Will be replaced with the Kanban board and project list in a later phase.

// === DEPENDENCIES ===
// lucide-react (FolderKanban icon)

import { FolderKanban } from 'lucide-react';

function ProjectsPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-surface-100">Projects</h1>
      <p className="mt-1 text-surface-400">
        Manage your project boards and tasks.
      </p>

      <div className="mt-12 flex flex-col items-center justify-center text-surface-500">
        <FolderKanban size={48} className="mb-4 text-surface-600" />
        <p className="text-lg">Your projects and boards will appear here</p>
      </div>
    </div>
  );
}

export default ProjectsPage;
