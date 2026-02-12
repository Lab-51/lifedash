// === FILE PURPOSE ===
// 404 Not Found page — shown when navigating to an unknown route.
// Renders inside AppLayout so sidebar navigation remains available.

import { Link } from 'react-router-dom';

function NotFoundPage() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4">
      <span className="text-6xl font-bold text-surface-700">404</span>
      <h1 className="text-xl text-surface-300">Page not found</h1>
      <p className="text-surface-500">The page you're looking for doesn't exist.</p>
      <Link
        to="/"
        className="mt-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 transition-colors"
      >
        Go to Projects
      </Link>
    </div>
  );
}

export default NotFoundPage;
