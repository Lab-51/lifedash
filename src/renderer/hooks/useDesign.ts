// === FILE PURPOSE ===
// Design hook stub — currently hardcoded to 'modern'.
// Kept as a placeholder for future theme support.

import { useEffect } from 'react';

export function useDesign() {
  useEffect(() => {
    document.documentElement.classList.remove('design-classic', 'design-modern');
    document.documentElement.setAttribute('data-design', 'modern');
    document.documentElement.classList.add('design-modern');
  }, []);
}
