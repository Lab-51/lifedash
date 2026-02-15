// === Brainstorm session and message types ===

export type BrainstormSessionStatus = 'active' | 'archived';
export type BrainstormMessageRole = 'user' | 'assistant';

export interface BrainstormSession {
  id: string;
  projectId: string | null;
  title: string;
  status: BrainstormSessionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface BrainstormMessage {
  id: string;
  sessionId: string;
  role: BrainstormMessageRole;
  content: string;
  createdAt: string;
}

export interface BrainstormSessionWithMessages extends BrainstormSession {
  messages: BrainstormMessage[];
}

export interface CreateBrainstormSessionInput {
  title: string;
  projectId?: string;
}

export interface BrainstormTemplate {
  id: string;
  name: string;
  description: string;
  icon: string; // lucide-react icon name
  starterPrompt: string; // pre-filled in chat input
}

export const BRAINSTORM_TEMPLATES: BrainstormTemplate[] = [
  {
    id: 'freeform',
    name: 'Free Form',
    description: 'Open-ended brainstorming — go wherever the ideas take you.',
    icon: 'Sparkles',
    starterPrompt: '',
  },
  {
    id: 'features',
    name: 'Feature Ideas',
    description: 'Brainstorm user-facing features with feasibility and MVP scope.',
    icon: 'Lightbulb',
    starterPrompt: 'I want to brainstorm new features for ',
  },
  {
    id: 'problem-solving',
    name: 'Problem Solving',
    description: 'Root cause analysis and structured debugging.',
    icon: 'Search',
    starterPrompt: "I'm facing a problem: ",
  },
  {
    id: 'architecture',
    name: 'Architecture Review',
    description: 'System design, trade-offs, scalability, and security.',
    icon: 'Layers',
    starterPrompt: 'I need to design ',
  },
  {
    id: 'sprint-planning',
    name: 'Sprint Planning',
    description: 'Break work into tasks, estimate effort, identify risks.',
    icon: 'ListChecks',
    starterPrompt: 'I need to plan work for ',
  },
];
