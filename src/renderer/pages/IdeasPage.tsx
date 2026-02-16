// === FILE PURPOSE ===
// Ideas page
// Dynamically renders either the Classic or Modern ideas view based on user preference.

import { useDesign } from '../hooks/useDesign';
import IdeasClassic from '../components/IdeasClassic';
import IdeasModern from '../components/IdeasModern';

function IdeasPage() {
  const { designVariant } = useDesign();

  if (designVariant === 'modern') {
    return <IdeasModern />;
  }

  return <IdeasClassic />;
}

export default IdeasPage;
