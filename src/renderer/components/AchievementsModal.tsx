// === FILE PURPOSE ===
// Modal displaying all achievements grouped by category.
// Shows unlock status, dates, and descriptions in a card grid layout.

import {
  X,
  Zap,
  Flame,
  Target,
  Cpu,
  Crown,
  Clock,
  BrainCircuit,
  TrendingUp,
  Calendar,
  CalendarCheck,
  Award,
  Trophy,
  SquarePlus,
  Layers,
  CheckSquare,
  ListChecks,
  FolderPlus,
  Bot,
  Mic,
  Video,
  ArrowRightCircle,
  Lightbulb,
  Sparkles,
  Brain,
  BrainCog,
  LayoutGrid,
  Rocket,
  BadgeCheck,
  Lock,
  Timer,
  Medal,
  Shield,
  Hourglass,
  TreePine,
  Flag,
  Infinity,
  History,
  Globe,
  Mountain,
  Gem,
  Star,
  Hash,
  Package,
  Database,
  ThumbsUp,
  Gift,
  Swords,
  CircleCheck,
  ScrollText,
  PenTool,
  GitBranch,
  FolderTree,
  Folders,
  Map as MapIcon,
  Archive,
  Wand2,
  Coffee,
  Headphones,
  Umbrella,
  Ear,
  FileText,
  BookOpen,
  Crosshair,
  Tornado,
  Compass,
  Sun,
  Waves,
  Send,
  Search,
  Eye,
  Wind,
  Hexagon,
  Anchor,
  Share,
  MessageCircle,
  GraduationCap,
  Wrench,
  Coins,
  Wallet,
  Skull,
  Heart,
  Bird,
  Moon,
  Snowflake,
  Users,
} from 'lucide-react';
import { useGamificationStore } from '../stores/gamificationStore';
import { ACHIEVEMENTS } from '../../shared/types/gamification';

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Zap, Flame, Target, Cpu, Crown, Clock, BrainCircuit, TrendingUp, Calendar, CalendarCheck, Award, Trophy,
  SquarePlus, Layers, CheckSquare, ListChecks, FolderPlus, Bot, Mic, Video, ArrowRightCircle,
  Lightbulb, Sparkles, Brain, BrainCog, LayoutGrid, Rocket, BadgeCheck,
  Timer, Medal, Shield, Hourglass, TreePine, Flag, Infinity, History, Globe, Mountain, Gem, Star,
  Hash, Package, Database, ThumbsUp, Gift, Swords, CircleCheck, ScrollText, PenTool, GitBranch,
  FolderTree, Folders, Map: MapIcon, Archive, Wand2, Coffee,
  Headphones, Umbrella, Ear, FileText, BookOpen, Crosshair, Tornado,
  Compass, Sun, Waves, Send, Search, Eye,
  Wind, Hexagon, Anchor, Share, MessageCircle, GraduationCap,
  Wrench, Coins, Wallet, Skull, Heart, Bird, Moon, Snowflake, Users,
};

interface AchievementsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Category display config
const CATEGORY_CONFIG: Array<{
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  borderColor: string;
  textColor: string;
  bgColor: string;
  headerBg: string;
}> = [
  { key: 'focus', label: 'Focus Achievements', icon: Zap, borderColor: 'border-emerald-500/30', textColor: 'text-emerald-400', bgColor: 'bg-emerald-500/10', headerBg: 'bg-emerald-500/5' },
  { key: 'cards', label: 'Card Achievements', icon: CheckSquare, borderColor: 'border-blue-500/30', textColor: 'text-blue-400', bgColor: 'bg-blue-500/10', headerBg: 'bg-blue-500/5' },
  { key: 'projects', label: 'Project Achievements', icon: FolderPlus, borderColor: 'border-purple-500/30', textColor: 'text-purple-400', bgColor: 'bg-purple-500/10', headerBg: 'bg-purple-500/5' },
  { key: 'meetings', label: 'Meeting Achievements', icon: Mic, borderColor: 'border-amber-500/30', textColor: 'text-amber-400', bgColor: 'bg-amber-500/10', headerBg: 'bg-amber-500/5' },
  { key: 'ideas', label: 'Idea Achievements', icon: Lightbulb, borderColor: 'border-pink-500/30', textColor: 'text-pink-400', bgColor: 'bg-pink-500/10', headerBg: 'bg-pink-500/5' },
  { key: 'brainstorm', label: 'Brainstorm Achievements', icon: Brain, borderColor: 'border-cyan-500/30', textColor: 'text-cyan-400', bgColor: 'bg-cyan-500/10', headerBg: 'bg-cyan-500/5' },
  { key: 'cross', label: 'Cross-Feature Achievements', icon: LayoutGrid, borderColor: 'border-yellow-500/30', textColor: 'text-yellow-400', bgColor: 'bg-yellow-500/10', headerBg: 'bg-yellow-500/5' },
];

function AchievementsModal({ isOpen, onClose }: AchievementsModalProps) {
  const achievements = useGamificationStore(s => s.achievements);

  if (!isOpen) return null;

  const unlockedMap = new Map(
    achievements.filter(a => a.unlockedAt !== null).map(a => [a.id, a.unlockedAt!]),
  );

  // Group achievements by category
  const grouped: Record<string, typeof ACHIEVEMENTS[number][]> = {};
  for (const ach of ACHIEVEMENTS) {
    if (!grouped[ach.category]) grouped[ach.category] = [];
    grouped[ach.category].push(ach);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[80vh] bg-white dark:bg-surface-900 rounded-xl border border-surface-200 dark:border-surface-700 shadow-xl dark:shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-200 dark:border-surface-700 shrink-0">
          <div className="flex items-center gap-2">
            <Trophy size={18} className="text-emerald-400" />
            <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">Achievements</h2>
            <span className="text-sm text-surface-400 ml-2">
              {unlockedMap.size}/{ACHIEVEMENTS.length} unlocked
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {CATEGORY_CONFIG.map((cat) => {
            const items = grouped[cat.key];
            if (!items || items.length === 0) return null;
            const catUnlockedCount = items.filter(a => unlockedMap.has(a.id)).length;
            const CatIcon = cat.icon;

            return (
              <div key={cat.key}>
                {/* Category Header */}
                <div className={`flex items-center gap-2 mb-3 px-3 py-2 rounded-lg ${cat.headerBg}`}>
                  <CatIcon size={16} className={cat.textColor} />
                  <h3 className={`text-sm font-semibold ${cat.textColor}`}>{cat.label}</h3>
                  <span className="text-xs text-surface-500 ml-auto">
                    {catUnlockedCount}/{items.length} unlocked
                  </span>
                </div>

                {/* Achievement Cards Grid */}
                <div className="grid grid-cols-3 gap-3">
                  {items.map((ach) => {
                    const Icon = ICON_MAP[ach.icon] || Zap;
                    const unlocked = unlockedMap.has(ach.id);
                    const unlockedAt = unlockedMap.get(ach.id);

                    return (
                      <div
                        key={ach.id}
                        className={`rounded-xl border p-3 transition-colors ${
                          unlocked
                            ? `${cat.borderColor} bg-surface-100/50 dark:bg-surface-800/50`
                            : 'border-surface-200 dark:border-surface-700/50 bg-surface-100/50 dark:bg-surface-800/30'
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          {/* Icon */}
                          <div
                            className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                              unlocked
                                ? `${cat.bgColor} ${cat.textColor}`
                                : 'bg-surface-700/50 text-surface-500'
                            }`}
                          >
                            {unlocked ? <Icon size={18} /> : <Lock size={14} />}
                          </div>
                          {/* Text */}
                          <div className="min-w-0">
                            <p className={`text-sm font-semibold leading-tight ${
                              unlocked ? 'text-surface-900 dark:text-surface-100' : 'text-surface-500'
                            }`}>
                              {ach.name}
                            </p>
                            <p className={`text-xs mt-0.5 leading-snug ${
                              unlocked ? 'text-surface-400' : 'text-surface-600'
                            }`}>
                              {ach.description}
                            </p>
                            {unlocked && unlockedAt && (
                              <p className="text-[10px] text-surface-500 mt-1">
                                Unlocked {new Date(unlockedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default AchievementsModal;
