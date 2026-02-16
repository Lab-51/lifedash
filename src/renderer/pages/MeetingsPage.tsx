// === FILE PURPOSE ===
// Meetings page
// Dynamically renders either the Classic or Modern meetings view based on user preference.

import { useDesign } from '../hooks/useDesign';
import MeetingsClassic from '../components/MeetingsClassic';
import MeetingsModern from '../components/MeetingsModern';

function MeetingsPage() {
  const { designVariant } = useDesign();

  if (designVariant === 'modern') {
    return <MeetingsModern />;
  }

  return <MeetingsClassic />;
}

export default MeetingsPage;
