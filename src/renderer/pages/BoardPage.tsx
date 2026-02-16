// === FILE PURPOSE ===
// Board Page
// Dynamically renders either the Classic or Modern board view based on user preference.

import { useDesign } from '../hooks/useDesign';
import BoardPageClassic from '../components/BoardPageClassic';
import BoardPageModern from '../components/BoardPageModern';

function BoardPage() {
  const { designVariant } = useDesign();

  if (designVariant === 'modern') {
    return <BoardPageModern />;
  }

  return <BoardPageClassic />;
}

export default BoardPage;
