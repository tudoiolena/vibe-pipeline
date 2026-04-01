export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      projects: {
        Row: {
          id: string;
          slug: string;
          name: string;
          description: string | null;
          status:
            | "draft"
            | "intake"
            | "clarify"
            | "prd"
            | "tasks"
            | "design_sync"
            | "handoff"
            | "approved"
            | "exported"
            | "archived";
          source_figma_url: string | null;
          source_repo_url: string | null;
          source_links: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          description?: string | null;
          status?:
            | "draft"
            | "intake"
            | "clarify"
            | "prd"
            | "tasks"
            | "design_sync"
            | "handoff"
            | "approved"
            | "exported"
            | "archived";
          source_figma_url?: string | null;
          source_repo_url?: string | null;
          source_links?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          slug?: string;
          name?: string;
          description?: string | null;
          status?:
            | "draft"
            | "intake"
            | "clarify"
            | "prd"
            | "tasks"
            | "design_sync"
            | "handoff"
            | "approved"
            | "exported"
            | "archived";
          source_figma_url?: string | null;
          source_repo_url?: string | null;
          source_links?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      project_sessions: {
        Row: {
          id: string;
          project_id: string;
          session_version: number;
          current_stage:
            | "intake"
            | "analysis"
            | "clarify"
            | "prd"
            | "tasks"
            | "design_sync"
            | "handoff"
            | "export";
          graph_status: "idle" | "running" | "interrupted_for_input" | "failed" | "completed";
          state_json: Json;
          last_node: string | null;
          last_error: Json | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          session_version?: number;
          current_stage:
            | "intake"
            | "analysis"
            | "clarify"
            | "prd"
            | "tasks"
            | "design_sync"
            | "handoff"
            | "export";
          graph_status?: "idle" | "running" | "interrupted_for_input" | "failed" | "completed";
          state_json?: Json;
          last_node?: string | null;
          last_error?: Json | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          session_version?: number;
          current_stage?:
            | "intake"
            | "analysis"
            | "clarify"
            | "prd"
            | "tasks"
            | "design_sync"
            | "handoff"
            | "export";
          graph_status?: "idle" | "running" | "interrupted_for_input" | "failed" | "completed";
          state_json?: Json;
          last_node?: string | null;
          last_error?: Json | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_sessions_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          }
        ];
      };
      langgraph_checkpoints: {
        Row: {
          id: string;
          session_id: string;
          checkpoint_id: string;
          checkpoint_ts: string | null;
          pipeline_state_json: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          checkpoint_id: string;
          checkpoint_ts?: string | null;
          pipeline_state_json: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          checkpoint_id?: string;
          checkpoint_ts?: string | null;
          pipeline_state_json?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "langgraph_checkpoints_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "project_sessions";
            referencedColumns: ["id"];
          }
        ];
      };
      clarifications: {
        Row: {
          id: string;
          project_id: string;
          session_id: string | null;
          question_key: string;
          question_text: string;
          category: "roles" | "nfr" | "edge_case" | "integration" | "security" | "scope" | "data" | "workflow";
          priority: "low" | "medium" | "high" | "critical";
          answer_text: string | null;
          status: "open" | "answered" | "resolved" | "dismissed";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          session_id?: string | null;
          question_key: string;
          question_text: string;
          category: "roles" | "nfr" | "edge_case" | "integration" | "security" | "scope" | "data" | "workflow";
          priority?: "low" | "medium" | "high" | "critical";
          answer_text?: string | null;
          status?: "open" | "answered" | "resolved" | "dismissed";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          session_id?: string | null;
          question_key?: string;
          question_text?: string;
          category?: "roles" | "nfr" | "edge_case" | "integration" | "security" | "scope" | "data" | "workflow";
          priority?: "low" | "medium" | "high" | "critical";
          answer_text?: string | null;
          status?: "open" | "answered" | "resolved" | "dismissed";
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "clarifications_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "clarifications_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "project_sessions";
            referencedColumns: ["id"];
          }
        ];
      };
      artifacts: {
        Row: {
          id: string;
          project_id: string;
          session_id: string | null;
          artifact_type:
            | "brief"
            | "clarifications"
            | "prd"
            | "scope"
            | "user_stories"
            | "acceptance_criteria"
            | "design_map"
            | "implementation_plan"
            | "test_plan"
            | "done_definition"
            | "tasks"
            | "cursor_rules"
            | "implementation_pack";
          format: "md" | "json";
          version: number;
          status: "draft" | "review" | "approved" | "exported" | "superseded";
          content_md: string | null;
          content_json: Json | null;
          checksum_sha256: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          session_id?: string | null;
          artifact_type:
            | "brief"
            | "clarifications"
            | "prd"
            | "scope"
            | "user_stories"
            | "acceptance_criteria"
            | "design_map"
            | "implementation_plan"
            | "test_plan"
            | "done_definition"
            | "tasks"
            | "cursor_rules"
            | "implementation_pack";
          format: "md" | "json";
          version: number;
          status?: "draft" | "review" | "approved" | "exported" | "superseded";
          content_md?: string | null;
          content_json?: Json | null;
          checksum_sha256?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          session_id?: string | null;
          artifact_type?:
            | "brief"
            | "clarifications"
            | "prd"
            | "scope"
            | "user_stories"
            | "acceptance_criteria"
            | "design_map"
            | "implementation_plan"
            | "test_plan"
            | "done_definition"
            | "tasks"
            | "cursor_rules"
            | "implementation_pack";
          format?: "md" | "json";
          version?: number;
          status?: "draft" | "review" | "approved" | "exported" | "superseded";
          content_md?: string | null;
          content_json?: Json | null;
          checksum_sha256?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "artifacts_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "artifacts_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "project_sessions";
            referencedColumns: ["id"];
          }
        ];
      };
      tasks: {
        Row: {
          id: string;
          project_id: string;
          session_id: string | null;
          parent_task_id: string | null;
          hierarchy_level: 0 | 1 | 2;
          task_type: "epic" | "task" | "subtask";
          external_key: string;
          title: string;
          description: string | null;
          status: "todo" | "in_progress" | "blocked" | "review" | "done" | "cancelled";
          priority: "low" | "medium" | "high" | "critical";
          estimate_points: number | null;
          acceptance_criteria: Json;
          dependencies: Json;
          metadata: Json;
          linear_issue_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          session_id?: string | null;
          parent_task_id?: string | null;
          hierarchy_level: 0 | 1 | 2;
          task_type: "epic" | "task" | "subtask";
          external_key: string;
          title: string;
          description?: string | null;
          status?: "todo" | "in_progress" | "blocked" | "review" | "done" | "cancelled";
          priority?: "low" | "medium" | "high" | "critical";
          estimate_points?: number | null;
          acceptance_criteria?: Json;
          dependencies?: Json;
          metadata?: Json;
          linear_issue_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          session_id?: string | null;
          parent_task_id?: string | null;
          hierarchy_level?: 0 | 1 | 2;
          task_type?: "epic" | "task" | "subtask";
          external_key?: string;
          title?: string;
          description?: string | null;
          status?: "todo" | "in_progress" | "blocked" | "review" | "done" | "cancelled";
          priority?: "low" | "medium" | "high" | "critical";
          estimate_points?: number | null;
          acceptance_criteria?: Json;
          dependencies?: Json;
          metadata?: Json;
          linear_issue_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "project_sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey";
            columns: ["parent_task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          }
        ];
      };
      design_nodes: {
        Row: {
          id: string;
          project_id: string;
          figma_file_key: string;
          node_id: string;
          node_type: string;
          node_name: string;
          figma_url: string | null;
          raw_payload: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          figma_file_key: string;
          node_id: string;
          node_type: string;
          node_name: string;
          figma_url?: string | null;
          raw_payload?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          figma_file_key?: string;
          node_id?: string;
          node_type?: string;
          node_name?: string;
          figma_url?: string | null;
          raw_payload?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "design_nodes_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          }
        ];
      };
      design_task_links: {
        Row: {
          id: string;
          project_id: string;
          design_node_id: string;
          task_id: string;
          relation_type: "screen_to_epic" | "component_to_task" | "variant_to_acceptance_criteria" | "token_to_constraint";
          confidence_score: number;
          implementation_status: "not_started" | "in_progress" | "implemented" | "verified" | "blocked";
          evidence: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          design_node_id: string;
          task_id: string;
          relation_type: "screen_to_epic" | "component_to_task" | "variant_to_acceptance_criteria" | "token_to_constraint";
          confidence_score: number;
          implementation_status?: "not_started" | "in_progress" | "implemented" | "verified" | "blocked";
          evidence?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          design_node_id?: string;
          task_id?: string;
          relation_type?: "screen_to_epic" | "component_to_task" | "variant_to_acceptance_criteria" | "token_to_constraint";
          confidence_score?: number;
          implementation_status?: "not_started" | "in_progress" | "implemented" | "verified" | "blocked";
          evidence?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "design_task_links_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "design_task_links_design_node_id_fkey";
            columns: ["design_node_id"];
            isOneToOne: false;
            referencedRelation: "design_nodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "design_task_links_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type PublicSchema = Database["public"];
export type TableName = keyof PublicSchema["Tables"];
export type TableRow<T extends TableName> = PublicSchema["Tables"][T]["Row"];
export type TableInsert<T extends TableName> = PublicSchema["Tables"][T]["Insert"];
export type TableUpdate<T extends TableName> = PublicSchema["Tables"][T]["Update"];
