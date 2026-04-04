export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          id: string
          project_id: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          id?: string
          project_id?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          id?: string
          project_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      citation_history: {
        Row: {
          created_at: string
          formatted_output: string
          id: string
          is_verified: boolean | null
          project_id: string | null
          raw_input: string
          source_type: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          formatted_output: string
          id?: string
          is_verified?: boolean | null
          project_id?: string | null
          raw_input: string
          source_type?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          formatted_output?: string
          id?: string
          is_verified?: boolean | null
          project_id?: string | null
          raw_input?: string
          source_type?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "citation_history_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          citation_count: number
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_subscribed: boolean
        }
        Insert: {
          citation_count?: number
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          is_subscribed?: boolean
        }
        Update: {
          citation_count?: number
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_subscribed?: boolean
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      verified_sources: {
        Row: {
          auto_verified: boolean | null
          full_citation: string
          id: string
          identity_key: string | null
          metadata: Json | null
          page: string | null
          search_text: string
          source_name: string
          source_type: string
          usage_count: number
          verification_status: string
          verified_at: string
          verified_by: string | null
          volume: string | null
          year: string | null
        }
        Insert: {
          auto_verified?: boolean | null
          full_citation: string
          id?: string
          identity_key?: string | null
          metadata?: Json | null
          page?: string | null
          search_text: string
          source_name: string
          source_type: string
          usage_count?: number
          verification_status?: string
          verified_at?: string
          verified_by?: string | null
          volume?: string | null
          year?: string | null
        }
        Update: {
          auto_verified?: boolean | null
          full_citation?: string
          id?: string
          identity_key?: string | null
          metadata?: Json | null
          page?: string | null
          search_text?: string
          source_name?: string
          source_type?: string
          usage_count?: number
          verification_status?: string
          verified_at?: string
          verified_by?: string | null
          volume?: string | null
          year?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      public_verified_sources: {
        Row: {
          auto_verified: boolean | null
          full_citation: string | null
          id: string | null
          identity_key: string | null
          metadata: Json | null
          page: string | null
          search_text: string | null
          source_name: string | null
          source_type: string | null
          usage_count: number | null
          verification_status: string | null
          verified_at: string | null
          volume: string | null
          year: string | null
        }
        Insert: {
          auto_verified?: boolean | null
          full_citation?: string | null
          id?: string | null
          identity_key?: string | null
          metadata?: Json | null
          page?: string | null
          search_text?: string | null
          source_name?: string | null
          source_type?: string | null
          usage_count?: number | null
          verification_status?: string | null
          verified_at?: string | null
          volume?: string | null
          year?: string | null
        }
        Update: {
          auto_verified?: boolean | null
          full_citation?: string | null
          id?: string | null
          identity_key?: string | null
          metadata?: Json | null
          page?: string | null
          search_text?: string | null
          source_name?: string | null
          source_type?: string | null
          usage_count?: number | null
          verification_status?: string | null
          verified_at?: string | null
          volume?: string | null
          year?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      compute_verified_source_identity: {
        Args: {
          _full_citation: string
          _source_name: string
          _source_type: string
          _year: string
        }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_citation_count: { Args: never; Returns: undefined }
      increment_usage_count: { Args: { source_id: string }; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
