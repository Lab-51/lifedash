// === FILE PURPOSE ===
// Meetings page — deep-link alias into Sessions Home (/meetings?openMeeting=...
// and ?action=record links throughout the app still resolve here).

import SessionsHome from '../components/SessionsHome';

export default function MeetingsPage() {
  return <SessionsHome />;
}
