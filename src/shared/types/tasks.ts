// === Task structuring types: project plans, pillars, milestones ===

export interface ProjectPillar {
  name: string;
  description: string;
  tasks: PillarTask[];
}

export interface PillarTask {
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  effort: 'small' | 'medium' | 'large';
  dependencies?: string[];
}

export interface ProjectMilestone {
  name: string;
  description: string;
  taskTitles: string[];
}

export interface ProjectPlan {
  pillars: ProjectPillar[];
  milestones: ProjectMilestone[];
  summary: string;
}

export interface SubtaskSuggestion {
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  effort: 'small' | 'medium' | 'large';
  order: number;
}

export interface TaskBreakdown {
  subtasks: SubtaskSuggestion[];
  notes: string;
}
