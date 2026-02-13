// === Idea repository types ===

export type IdeaStatus = 'new' | 'exploring' | 'active' | 'archived';
export type EffortLevel = 'trivial' | 'small' | 'medium' | 'large' | 'epic';
export type ImpactLevel = 'minimal' | 'low' | 'medium' | 'high' | 'critical';

export interface Idea {
  id: string;
  projectId: string | null;
  title: string;
  description: string | null;
  status: IdeaStatus;
  effort: EffortLevel | null;
  impact: ImpactLevel | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateIdeaInput {
  title: string;
  description?: string;
  projectId?: string;
  tags?: string[];
}

export interface UpdateIdeaInput {
  title?: string;
  description?: string | null;
  projectId?: string | null;
  status?: IdeaStatus;
  effort?: EffortLevel | null;
  impact?: ImpactLevel | null;
  tags?: string[];
}

export interface ConvertIdeaToCardInput {
  ideaId: string;
  columnId: string;
}

export interface ConvertIdeaToProjectResult {
  idea: Idea;
  projectId: string;
}

export interface ConvertIdeaToCardResult {
  idea: Idea;
  cardId: string;
}

export interface IdeaAnalysis {
  suggestedEffort: EffortLevel;
  suggestedImpact: ImpactLevel;
  feasibilityNotes: string;
  rationale: string;
}
