// Generated from the live `vizion` Supabase project schema.
// Regenerate with the Supabase CLI/MCP after migrations:
//   supabase gen types typescript --project-id <ref> > src/lib/supabase/database.types.ts
// Do not edit by hand.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      prompts: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          current_ver: string | null;
          target_model: Database["public"]["Enums"]["model_target"];
          tags: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          current_ver?: string | null;
          target_model: Database["public"]["Enums"]["model_target"];
          tags?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          current_ver?: string | null;
          target_model?: Database["public"]["Enums"]["model_target"];
          tags?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      prompt_versions: {
        Row: {
          id: string;
          prompt_id: string;
          parent_ver: string | null;
          input_text: string;
          output_text: string;
          rationale: string | null;
          mode: Database["public"]["Enums"]["enhance_mode"];
          model_used: string;
          token_in: number;
          token_out: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          prompt_id: string;
          parent_ver?: string | null;
          input_text: string;
          output_text: string;
          rationale?: string | null;
          mode: Database["public"]["Enums"]["enhance_mode"];
          model_used: string;
          token_in?: number;
          token_out?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          prompt_id?: string;
          parent_ver?: string | null;
          input_text?: string;
          output_text?: string;
          rationale?: string | null;
          mode?: Database["public"]["Enums"]["enhance_mode"];
          model_used?: string;
          token_in?: number;
          token_out?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      activity_events: {
        Row: {
          id: string;
          user_id: string;
          prompt_id: string | null;
          type: Database["public"]["Enums"]["activity_type"];
          meta: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          prompt_id?: string | null;
          type: Database["public"]["Enums"]["activity_type"];
          meta?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          prompt_id?: string | null;
          type?: Database["public"]["Enums"]["activity_type"];
          meta?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      usage_events: {
        Row: {
          id: string;
          user_id: string;
          target: Database["public"]["Enums"]["model_target"];
          mode: string;
          model_used: string;
          token_in: number;
          token_out: number;
          cost_usd: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          target: Database["public"]["Enums"]["model_target"];
          mode: string;
          model_used: string;
          token_in?: number;
          token_out?: number;
          cost_usd?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          target?: Database["public"]["Enums"]["model_target"];
          mode?: string;
          model_used?: string;
          token_in?: number;
          token_out?: number;
          cost_usd?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      oauth_identities: {
        Row: {
          id: string;
          linked_at: string;
          provider: Database["public"]["Enums"]["oauth_provider"];
          provider_uid: string;
          raw_profile: Json | null;
          user_id: string;
        };
        Insert: {
          id?: string;
          linked_at?: string;
          provider: Database["public"]["Enums"]["oauth_provider"];
          provider_uid: string;
          raw_profile?: Json | null;
          user_id: string;
        };
        Update: {
          id?: string;
          linked_at?: string;
          provider?: Database["public"]["Enums"]["oauth_provider"];
          provider_uid?: string;
          raw_profile?: Json | null;
          user_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          auth_method: Database["public"]["Enums"]["auth_method"] | null;
          avatar_url: string | null;
          created_at: string;
          default_model: Database["public"]["Enums"]["model_target"];
          display_name: string | null;
          email: string | null;
          full_name: string | null;
          password_set: boolean;
          theme: Database["public"]["Enums"]["theme"];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          auth_method?: Database["public"]["Enums"]["auth_method"] | null;
          avatar_url?: string | null;
          created_at?: string;
          default_model?: Database["public"]["Enums"]["model_target"];
          display_name?: string | null;
          email?: string | null;
          full_name?: string | null;
          password_set?: boolean;
          theme?: Database["public"]["Enums"]["theme"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          auth_method?: Database["public"]["Enums"]["auth_method"] | null;
          avatar_url?: string | null;
          created_at?: string;
          default_model?: Database["public"]["Enums"]["model_target"];
          display_name?: string | null;
          email?: string | null;
          full_name?: string | null;
          password_set?: boolean;
          theme?: Database["public"]["Enums"]["theme"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      usage_window: {
        Args: { p_rate_seconds: number };
        Returns: { recent_count: number; today_cost: number }[];
      };
    };
    Enums: {
      activity_type:
        | "created"
        | "enhanced"
        | "saved"
        | "shared"
        | "restored"
        | "profile_updated";
      auth_method: "magic_link" | "github" | "google";
      enhance_mode: "clarify" | "expand" | "condense" | "reformat" | "target";
      model_target: "opus_4_8" | "gpt_5_5" | "gemini_pro_3_1";
      oauth_provider: "github" | "google";
      theme: "dark" | "light" | "system";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DefaultSchema = Database["public"];

export type Tables<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Update"];
export type Enums<T extends keyof DefaultSchema["Enums"]> = DefaultSchema["Enums"][T];

export type Profile = Tables<"profiles">;
export type OAuthIdentity = Tables<"oauth_identities">;
export type Prompt = Tables<"prompts">;
export type PromptVersion = Tables<"prompt_versions">;
export type ActivityEvent = Tables<"activity_events">;
