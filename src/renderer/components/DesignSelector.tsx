// === FILE PURPOSE ===
// Design selector component for the Appearance section of the Settings page.
// Switches between Classic and Modern designs.

import { LayoutTemplate, Boxes } from 'lucide-react';
import { useDesign } from '../hooks/useDesign';
import type { DesignVariant } from '../hooks/useDesign';

const DESIGN_OPTIONS: { variant: DesignVariant; label: string; description: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
    { variant: 'classic', label: 'Classic', description: 'Original clean slate design', icon: LayoutTemplate },
    { variant: 'modern', label: 'Modern', description: 'Fresh, enterprise-grade look', icon: Boxes },
];

export default function DesignSelector() {
    const { designVariant, setDesign } = useDesign();

    return (
        <div className="flex gap-3">
            {DESIGN_OPTIONS.map(({ variant, label, description, icon: Icon }) => (
                <button key={variant} onClick={() => setDesign(variant)}
                    className={`flex-1 p-3 rounded-lg border text-left transition-colors ${designVariant === variant
                            ? 'border-primary-500 bg-primary-500/10 text-primary-400'
                            : 'border-surface-700 bg-surface-800 text-surface-300 hover:border-surface-600'
                        }`}>
                    <Icon size={20} className="mb-1.5" />
                    <div className="text-sm font-medium">{label}</div>
                    <div className="text-xs text-surface-500 mt-0.5">{description}</div>
                </button>
            ))}
        </div>
    );
}
