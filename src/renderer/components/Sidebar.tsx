// === FILE PURPOSE ===
// Sidebar Controller
// Dynamically renders either the Classic or Modern sidebar based on user preference.

import { useDesign } from '../hooks/useDesign';
import SidebarClassic from './SidebarClassic';
import SidebarModern from './SidebarModern';

function Sidebar() {
  const { designVariant } = useDesign();

  if (designVariant === 'modern') {
    return <SidebarModern />;
  }

  return <SidebarClassic />;
}

export default Sidebar;
