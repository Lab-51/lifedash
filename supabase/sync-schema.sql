-- ============================================================================
-- LifeDash — Supabase Cloud Sync Schema
-- ============================================================================
-- Creates the 16 tables used for bidirectional sync between LifeDash desktop
-- and the web companion. Both sides can read and write; last-write-wins.
--
-- IDEMPOTENT: Safe to re-run. Uses IF NOT EXISTS for tables/indexes and
-- DROP/CREATE for policies (Postgres has no CREATE POLICY IF NOT EXISTS).
--
-- How to use:
--   1. Open the Supabase SQL Editor for your project
--   2. Paste this entire file and run it
--   3. All tables, RLS policies, and indexes will be created
--
-- Notes:
--   - Every table includes user_id (FK to auth.users) and synced_at columns
--   - Row Level Security (RLS) is enabled on all tables
--   - Users can only access their own rows
--   - Audio recordings and local AI-generated content are NOT synced
-- ============================================================================

-- ============================================================================
-- TABLE: projects
-- ============================================================================
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  color VARCHAR(7),
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  hourly_rate REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own data" ON projects;
CREATE POLICY "Users own data" ON projects FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);

-- ============================================================================
-- TABLE: boards
-- ============================================================================
CREATE TABLE IF NOT EXISTS boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE boards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own data" ON boards;
CREATE POLICY "Users own data" ON boards FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_boards_user_id ON boards(user_id);
CREATE INDEX IF NOT EXISTS idx_boards_project_id ON boards(project_id);

-- ============================================================================
-- TABLE: columns
-- ============================================================================
CREATE TABLE IF NOT EXISTS columns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  board_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  color VARCHAR(7),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE columns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own data" ON columns;
CREATE POLICY "Users own data" ON columns FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_columns_user_id ON columns(user_id);
CREATE INDEX IF NOT EXISTS idx_columns_board_id ON columns(board_id);

-- ============================================================================
-- TABLE: cards
-- ============================================================================
CREATE TABLE IF NOT EXISTS cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  column_id UUID NOT NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  due_date TIMESTAMPTZ,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  recurrence_type VARCHAR(20),
  recurrence_end_date TIMESTAMPTZ,
  source_recurring_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE cards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own data" ON cards;
CREATE POLICY "Users own data" ON cards FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_cards_user_id ON cards(user_id);
CREATE INDEX IF NOT EXISTS idx_cards_column_id ON cards(column_id);
CREATE INDEX IF NOT EXISTS idx_cards_archived ON cards(archived);
CREATE INDEX IF NOT EXISTS idx_cards_updated_at ON cards(updated_at);

-- ============================================================================
-- TABLE: labels
-- ============================================================================
CREATE TABLE IF NOT EXISTS labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL,
  name VARCHAR(100) NOT NULL,
  color VARCHAR(7) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE labels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own data" ON labels;
CREATE POLICY "Users own data" ON labels FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_labels_user_id ON labels(user_id);
CREATE INDEX IF NOT EXISTS idx_labels_project_id ON labels(project_id);

-- ============================================================================
-- TABLE: card_labels (junction — composite PK)
-- ============================================================================
CREATE TABLE IF NOT EXISTS card_labels (
  card_id UUID NOT NULL,
  label_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (card_id, label_id)
);

ALTER TABLE card_labels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own data" ON card_labels;
CREATE POLICY "Users own data" ON card_labels FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_card_labels_user_id ON card_labels(user_id);
CREATE INDEX IF NOT EXISTS idx_card_labels_card_id ON card_labels(card_id);

-- ============================================================================
-- TABLE: card_comments
-- ============================================================================
CREATE TABLE IF NOT EXISTS card_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id UUID NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE card_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own data" ON card_comments;
CREATE POLICY "Users own data" ON card_comments FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_card_comments_user_id ON card_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_card_comments_card_id ON card_comments(card_id);

-- ============================================================================
-- TABLE: card_checklist_items
-- ============================================================================
CREATE TABLE IF NOT EXISTS card_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id UUID NOT NULL,
  title VARCHAR(500) NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE card_checklist_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own data" ON card_checklist_items;
CREATE POLICY "Users own data" ON card_checklist_items FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_card_checklist_items_user_id ON card_checklist_items(user_id);
CREATE INDEX IF NOT EXISTS idx_card_checklist_items_card_id ON card_checklist_items(card_id);

-- ============================================================================
-- TABLE: meetings (audio_path and prep_briefing EXCLUDED — local only)
-- ============================================================================
CREATE TABLE IF NOT EXISTS meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID,
  title VARCHAR(500) NOT NULL,
  template TEXT NOT NULL DEFAULT 'none'
    CHECK (template IN ('none', 'standup', 'retro', 'planning', 'brainstorm', 'one_on_one')),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'recording'
    CHECK (status IN ('recording', 'processing', 'completed')),
  transcription_language VARCHAR(10),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own data" ON meetings;
CREATE POLICY "Users own data" ON meetings FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_meetings_user_id ON meetings(user_id);
CREATE INDEX IF NOT EXISTS idx_meetings_project_id ON meetings(project_id);

-- ============================================================================
-- TABLE: meeting_briefs
-- ============================================================================
CREATE TABLE IF NOT EXISTS meeting_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL,
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE meeting_briefs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own data" ON meeting_briefs;
CREATE POLICY "Users own data" ON meeting_briefs FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_meeting_briefs_user_id ON meeting_briefs(user_id);
CREATE INDEX IF NOT EXISTS idx_meeting_briefs_meeting_id ON meeting_briefs(meeting_id);

-- ============================================================================
-- TABLE: action_items
-- ============================================================================
CREATE TABLE IF NOT EXISTS action_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL,
  card_id UUID,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'dismissed', 'converted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE action_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own data" ON action_items;
CREATE POLICY "Users own data" ON action_items FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_action_items_user_id ON action_items(user_id);
CREATE INDEX IF NOT EXISTS idx_action_items_meeting_id ON action_items(meeting_id);
CREATE INDEX IF NOT EXISTS idx_action_items_status ON action_items(status);

-- ============================================================================
-- TABLE: ideas
-- ============================================================================
CREATE TABLE IF NOT EXISTS ideas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'exploring', 'active', 'archived')),
  effort TEXT
    CHECK (effort IS NULL OR effort IN ('trivial', 'small', 'medium', 'large', 'epic')),
  impact TEXT
    CHECK (impact IS NULL OR impact IN ('minimal', 'low', 'medium', 'high', 'critical')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ideas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own data" ON ideas;
CREATE POLICY "Users own data" ON ideas FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_ideas_user_id ON ideas(user_id);
CREATE INDEX IF NOT EXISTS idx_ideas_project_id ON ideas(project_id);

-- ============================================================================
-- TABLE: idea_tags (junction — composite PK)
-- ============================================================================
CREATE TABLE IF NOT EXISTS idea_tags (
  idea_id UUID NOT NULL,
  tag VARCHAR(100) NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (idea_id, tag)
);

ALTER TABLE idea_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own data" ON idea_tags;
CREATE POLICY "Users own data" ON idea_tags FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_idea_tags_user_id ON idea_tags(user_id);
CREATE INDEX IF NOT EXISTS idx_idea_tags_idea_id ON idea_tags(idea_id);

-- ============================================================================
-- TABLE: brainstorm_sessions
-- ============================================================================
CREATE TABLE IF NOT EXISTS brainstorm_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID,
  title VARCHAR(500) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE brainstorm_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own data" ON brainstorm_sessions;
CREATE POLICY "Users own data" ON brainstorm_sessions FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_brainstorm_sessions_user_id ON brainstorm_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_brainstorm_sessions_project_id ON brainstorm_sessions(project_id);

-- ============================================================================
-- TABLE: brainstorm_messages
-- ============================================================================
CREATE TABLE IF NOT EXISTS brainstorm_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  role TEXT NOT NULL
    CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE brainstorm_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own data" ON brainstorm_messages;
CREATE POLICY "Users own data" ON brainstorm_messages FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_brainstorm_messages_user_id ON brainstorm_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_brainstorm_messages_session_id ON brainstorm_messages(session_id);
