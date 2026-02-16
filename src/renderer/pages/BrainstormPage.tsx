// === FILE PURPOSE ===
// Brainstorm page
// Dynamically renders either the Classic or Modern brainstorm view based on user preference.

import { useDesign } from '../hooks/useDesign';
import BrainstormClassic from '../components/BrainstormClassic';
import BrainstormModern from '../components/BrainstormModern';

function BrainstormPage() {
  const { designVariant } = useDesign();

  if (designVariant === 'modern') {
    return <BrainstormModern />;
  }

  return <BrainstormClassic />;
}

export default BrainstormPage;
