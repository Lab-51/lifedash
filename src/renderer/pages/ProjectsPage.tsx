// === FILE PURPOSE ===
// Projects page
// Dynamically renders either the Classic or Modern projects view based on user preference.

import { useDesign } from '../hooks/useDesign';
import ProjectsClassic from '../components/ProjectsClassic';
import ProjectsModern from '../components/ProjectsModern';

function ProjectsPage() {
  const { designVariant } = useDesign();

  if (designVariant === 'modern') {
    return <ProjectsModern />;
  }

  return <ProjectsClassic />;
}

export default ProjectsPage;
