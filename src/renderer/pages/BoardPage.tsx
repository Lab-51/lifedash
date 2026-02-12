// === FILE PURPOSE ===
// Board view page — displays the Kanban board for a project.
// Currently a shell/placeholder. Full implementation in Plan 2.2.

// === DEPENDENCIES ===
// react (useEffect, useState), react-router-dom (useParams, Link),
// lucide-react (ArrowLeft, Columns3), shared types (Project)

import { useParams, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { ArrowLeft, Columns3 } from 'lucide-react';
import type { Project } from '../../shared/types';

function BoardPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    if (!projectId) return;
    window.electronAPI.getProjects().then(projects => {
      const found = projects.find(p => p.id === projectId);
      if (found) setProject(found);
    });
  }, [projectId]);

  return (
    <div className="flex-1 flex flex-col p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link
          to="/"
          className="text-surface-400 hover:text-surface-200 transition-colors"
        >
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-2xl font-bold text-surface-100">
          {project?.name ?? 'Loading...'}
        </h1>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center text-surface-500">
        <Columns3 size={48} className="mb-4 text-surface-600" />
        <p className="text-lg">Board view coming in Plan 2.2</p>
      </div>
    </div>
  );
}

export default BoardPage;
