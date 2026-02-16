// === FILE PURPOSE ===
// Home dashboard page
// Dynamically renders either the Classic or Modern dashboard based on the user's design preference.

import { useMemo } from 'react';
import { useDesign } from '../hooks/useDesign';
import DashboardClassic from '../components/DashboardClassic';
import DashboardModern from '../components/DashboardModern';

function DashboardPage() {
  const { designVariant } = useDesign();

  // Simple switch to render the appropriate component
  if (designVariant === 'modern') {
    return <DashboardModern />;
  }

  return <DashboardClassic />;
}

export default DashboardPage;
