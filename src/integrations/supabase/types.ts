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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      academic_sessions: {
        Row: {
          chapters: Json
          created_at: string
          current_chapter: number
          current_run_chapter_idx: number | null
          current_run_id: string | null
          current_run_step: string | null
          id: string
          last_academic_action: string | null
          max_reached_step: string
          outline: string
          project_id: string | null
          proposed_questions: Json
          research_question: string
          updated_at: string
          user_id: string
          wizard_step: string
        }
        Insert: {
          chapters?: Json
          created_at?: string
          current_chapter?: number
          current_run_chapter_idx?: number | null
          current_run_id?: string | null
          current_run_step?: string | null
          id?: string
          last_academic_action?: string | null
          max_reached_step: string
          outline?: string
          project_id?: string | null
          proposed_questions?: Json
          research_question?: string
          updated_at?: string
          user_id: string
          wizard_step: string
        }
        Update: {
          chapters?: Json
          created_at?: string
          current_chapter?: number
          current_run_chapter_idx?: number | null
          current_run_id?: string | null
          current_run_step?: string | null
          id?: string
          last_academic_action?: string | null
          max_reached_step?: string
          outline?: string
          project_id?: string | null
          proposed_questions?: Json
          research_question?: string
          updated_at?: string
          user_id?: string
          wizard_step?: string
        }
        Relationships: [
          {
            foreignKeyName: "academic_sessions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
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
      contact_messages: {
        Row: {
          created_at: string
          email: string
          first_name: string
          handled_at: string | null
          id: string
          last_name: string
          message: string
          metadata: Json
          status: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          first_name: string
          handled_at?: string | null
          id?: string
          last_name: string
          message: string
          metadata?: Json
          status?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          first_name?: string
          handled_at?: string | null
          id?: string
          last_name?: string
          message?: string
          metadata?: Json
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      credit_ledger: {
        Row: {
          amount: number
          balance_after_included: number
          balance_after_topup: number
          created_at: string
          event_type: string
          id: string
          included_delta: number
          metadata: Json
          reason: string | null
          request_id: string
          topup_delta: number
          user_id: string
        }
        Insert: {
          amount: number
          balance_after_included: number
          balance_after_topup: number
          created_at?: string
          event_type: string
          id?: string
          included_delta?: number
          metadata?: Json
          reason?: string | null
          request_id: string
          topup_delta?: number
          user_id: string
        }
        Update: {
          amount?: number
          balance_after_included?: number
          balance_after_topup?: number
          created_at?: string
          event_type?: string
          id?: string
          included_delta?: number
          metadata?: Json
          reason?: string | null
          request_id?: string
          topup_delta?: number
          user_id?: string
        }
        Relationships: []
      }
      document_check_sessions: {
        Row: {
          citations_count: number
          created_at: string
          decisions: Json
          file_name: string
          id: string
          metadata: Json
          notes: Json
          notes_count: number
          project_id: string | null
          status: string
          summary: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          citations_count?: number
          created_at?: string
          decisions?: Json
          file_name?: string
          id?: string
          metadata?: Json
          notes?: Json
          notes_count?: number
          project_id?: string | null
          status?: string
          summary?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          citations_count?: number
          created_at?: string
          decisions?: Json
          file_name?: string
          id?: string
          metadata?: Json
          notes?: Json
          notes_count?: number
          project_id?: string | null
          status?: string
          summary?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      legal_document_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          id: string
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          id?: string
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_document_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "legal_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_documents: {
        Row: {
          case_number: string | null
          citation: string
          content: string
          court: string | null
          created_at: string
          decision_date: string | null
          district: string | null
          docx_url: string | null
          embedding: string | null
          id: string
          ingestion_error: string | null
          ingestion_status: string
          judges: string | null
          metadata: Json | null
          pdf_url: string | null
          procedure_type: string | null
          scraped_at: string | null
          source_type: string
          source_url: string | null
          title: string
          updated_at: string
        }
        Insert: {
          case_number?: string | null
          citation: string
          content: string
          court?: string | null
          created_at?: string
          decision_date?: string | null
          district?: string | null
          docx_url?: string | null
          embedding?: string | null
          id?: string
          ingestion_error?: string | null
          ingestion_status?: string
          judges?: string | null
          metadata?: Json | null
          pdf_url?: string | null
          procedure_type?: string | null
          scraped_at?: string | null
          source_type: string
          source_url?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          case_number?: string | null
          citation?: string
          content?: string
          court?: string | null
          created_at?: string
          decision_date?: string | null
          district?: string | null
          docx_url?: string | null
          embedding?: string | null
          id?: string
          ingestion_error?: string | null
          ingestion_status?: string
          judges?: string | null
          metadata?: Json | null
          pdf_url?: string | null
          procedure_type?: string | null
          scraped_at?: string | null
          source_type?: string
          source_url?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      legal_research_jobs: {
        Row: {
          client_request_id: string | null
          completed_at: string | null
          completed_stages: string[]
          created_at: string
          credit_request_id: string | null
          current_stage: string | null
          error: string | null
          id: string
          last_progress_at: string | null
          progress_label_he: string | null
          project_id: string | null
          question: string
          result: Json | null
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          client_request_id?: string | null
          completed_at?: string | null
          completed_stages?: string[]
          created_at?: string
          credit_request_id?: string | null
          current_stage?: string | null
          error?: string | null
          id?: string
          last_progress_at?: string | null
          progress_label_he?: string | null
          project_id?: string | null
          question: string
          result?: Json | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          client_request_id?: string | null
          completed_at?: string | null
          completed_stages?: string[]
          created_at?: string
          credit_request_id?: string | null
          current_stage?: string | null
          error?: string | null
          id?: string
          last_progress_at?: string | null
          progress_label_he?: string | null
          project_id?: string | null
          question?: string
          result?: Json | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          billing_period_ends_at: string | null
          billing_period_started_at: string | null
          citation_count: number
          created_at: string
          credits_reset_mode: string
          email: string | null
          full_name: string | null
          id: string
          included_credits_remaining: number
          included_credits_total: number
          is_subscribed: boolean
          plan: string
          privacy_accepted_at: string | null
          privacy_version: string | null
          referral_bonus_granted: boolean
          referral_code: string
          referral_first_action_at: string | null
          referred_by_user_id: string | null
          terms_accepted_at: string | null
          terms_version: string | null
          topup_credits_remaining: number
        }
        Insert: {
          billing_period_ends_at?: string | null
          billing_period_started_at?: string | null
          citation_count?: number
          created_at?: string
          credits_reset_mode?: string
          email?: string | null
          full_name?: string | null
          id: string
          included_credits_remaining?: number
          included_credits_total?: number
          is_subscribed?: boolean
          plan?: string
          privacy_accepted_at?: string | null
          privacy_version?: string | null
          referral_bonus_granted?: boolean
          referral_code: string
          referral_first_action_at?: string | null
          referred_by_user_id?: string | null
          terms_accepted_at?: string | null
          terms_version?: string | null
          topup_credits_remaining?: number
        }
        Update: {
          billing_period_ends_at?: string | null
          billing_period_started_at?: string | null
          citation_count?: number
          created_at?: string
          credits_reset_mode?: string
          email?: string | null
          full_name?: string | null
          id?: string
          included_credits_remaining?: number
          included_credits_total?: number
          is_subscribed?: boolean
          plan?: string
          privacy_accepted_at?: string | null
          privacy_version?: string | null
          referral_bonus_granted?: boolean
          referral_code?: string
          referral_first_action_at?: string | null
          referred_by_user_id?: string | null
          terms_accepted_at?: string | null
          terms_version?: string | null
          topup_credits_remaining?: number
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
      qa_logs: {
        Row: {
          answer: string | null
          created_at: string
          footnotes: Json | null
          id: string
          local_footnotes_count: number
          metadata: Json | null
          perplexity_footnotes_count: number
          project_id: string | null
          question: string
          task_mode: string | null
          total_footnotes: number
          user_id: string
        }
        Insert: {
          answer?: string | null
          created_at?: string
          footnotes?: Json | null
          id?: string
          local_footnotes_count?: number
          metadata?: Json | null
          perplexity_footnotes_count?: number
          project_id?: string | null
          question: string
          task_mode?: string | null
          total_footnotes?: number
          user_id: string
        }
        Update: {
          answer?: string | null
          created_at?: string
          footnotes?: Json | null
          id?: string
          local_footnotes_count?: number
          metadata?: Json | null
          perplexity_footnotes_count?: number
          project_id?: string | null
          question?: string
          task_mode?: string | null
          total_footnotes?: number
          user_id?: string
        }
        Relationships: []
      }
      secondary_source_bodies: {
        Row: {
          acquisition_path: string | null
          body: string
          body_chars: number
          content_hash: string
          content_type: string | null
          created_at: string
          extraction_method: string | null
          final_url: string | null
          id: string
          mapped_type: string | null
          source_type: string | null
          title: string | null
          type_confidence: string | null
          updated_at: string
          url: string
        }
        Insert: {
          acquisition_path?: string | null
          body: string
          body_chars?: number
          content_hash: string
          content_type?: string | null
          created_at?: string
          extraction_method?: string | null
          final_url?: string | null
          id?: string
          mapped_type?: string | null
          source_type?: string | null
          title?: string | null
          type_confidence?: string | null
          updated_at?: string
          url: string
        }
        Update: {
          acquisition_path?: string | null
          body?: string
          body_chars?: number
          content_hash?: string
          content_type?: string | null
          created_at?: string
          extraction_method?: string | null
          final_url?: string | null
          id?: string
          mapped_type?: string | null
          source_type?: string | null
          title?: string | null
          type_confidence?: string | null
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
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
      v2_eval_runs: {
        Row: {
          agent_state: Json | null
          chunk_index: number
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          label: string | null
          question: string
          result: Json | null
          run_id: string
          status: string
        }
        Insert: {
          agent_state?: Json | null
          chunk_index?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          label?: string | null
          question: string
          result?: Json | null
          run_id: string
          status?: string
        }
        Update: {
          agent_state?: Json | null
          chunk_index?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          label?: string | null
          question?: string
          result?: Json | null
          run_id?: string
          status?: string
        }
        Relationships: []
      }
      verified_legal_source_texts: {
        Row: {
          chunk_index: number
          created_at: string
          embedding: string | null
          id: string
          source_id: string
          source_url: string | null
          text: string
        }
        Insert: {
          chunk_index: number
          created_at?: string
          embedding?: string | null
          id?: string
          source_id: string
          source_url?: string | null
          text: string
        }
        Update: {
          chunk_index?: number
          created_at?: string
          embedding?: string | null
          id?: string
          source_id?: string
          source_url?: string | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "verified_legal_source_texts_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "verified_legal_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      verified_legal_sources: {
        Row: {
          acquisition_method: string | null
          authority_type: string | null
          authors: string[]
          bibliographic_validated: boolean
          body_chars: number
          body_text_hash: string
          canonical_title: string | null
          case_prefix: string | null
          court: string | null
          created_at: string
          dedupe_docket: string | null
          dedupe_statute_section: string | null
          dedupe_statute_title: string | null
          discovery_strategy: string
          discovery_version: string
          failure_count: number
          id: string
          identity_confidence: string | null
          identity_evidence_summary: string | null
          identity_evidence_type: string[]
          identity_terms_matched: string[]
          identity_validated: boolean
          identity_validation_version: string | null
          institution: string | null
          invalidated_reason: string | null
          is_translation: boolean
          journal_or_publisher: string | null
          language: string | null
          last_failure_reason: string | null
          last_success_at: string | null
          last_used_at: string | null
          normalized_docket: string | null
          official_url: string | null
          party_names: string[]
          source_category: string
          source_host: string | null
          source_kind: string | null
          source_type: string
          status: string
          statute_section: string | null
          statute_title: string | null
          updated_at: string
          validated_docket: string | null
          validated_title: string | null
          validation_source: string | null
          verified_at: string | null
          year: number | null
        }
        Insert: {
          acquisition_method?: string | null
          authority_type?: string | null
          authors?: string[]
          bibliographic_validated?: boolean
          body_chars?: number
          body_text_hash: string
          canonical_title?: string | null
          case_prefix?: string | null
          court?: string | null
          created_at?: string
          dedupe_docket?: string | null
          dedupe_statute_section?: string | null
          dedupe_statute_title?: string | null
          discovery_strategy?: string
          discovery_version?: string
          failure_count?: number
          id?: string
          identity_confidence?: string | null
          identity_evidence_summary?: string | null
          identity_evidence_type?: string[]
          identity_terms_matched?: string[]
          identity_validated?: boolean
          identity_validation_version?: string | null
          institution?: string | null
          invalidated_reason?: string | null
          is_translation?: boolean
          journal_or_publisher?: string | null
          language?: string | null
          last_failure_reason?: string | null
          last_success_at?: string | null
          last_used_at?: string | null
          normalized_docket?: string | null
          official_url?: string | null
          party_names?: string[]
          source_category: string
          source_host?: string | null
          source_kind?: string | null
          source_type: string
          status?: string
          statute_section?: string | null
          statute_title?: string | null
          updated_at?: string
          validated_docket?: string | null
          validated_title?: string | null
          validation_source?: string | null
          verified_at?: string | null
          year?: number | null
        }
        Update: {
          acquisition_method?: string | null
          authority_type?: string | null
          authors?: string[]
          bibliographic_validated?: boolean
          body_chars?: number
          body_text_hash?: string
          canonical_title?: string | null
          case_prefix?: string | null
          court?: string | null
          created_at?: string
          dedupe_docket?: string | null
          dedupe_statute_section?: string | null
          dedupe_statute_title?: string | null
          discovery_strategy?: string
          discovery_version?: string
          failure_count?: number
          id?: string
          identity_confidence?: string | null
          identity_evidence_summary?: string | null
          identity_evidence_type?: string[]
          identity_terms_matched?: string[]
          identity_validated?: boolean
          identity_validation_version?: string | null
          institution?: string | null
          invalidated_reason?: string | null
          is_translation?: boolean
          journal_or_publisher?: string | null
          language?: string | null
          last_failure_reason?: string | null
          last_success_at?: string | null
          last_used_at?: string | null
          normalized_docket?: string | null
          official_url?: string | null
          party_names?: string[]
          source_category?: string
          source_host?: string | null
          source_kind?: string | null
          source_type?: string
          status?: string
          statute_section?: string | null
          statute_title?: string | null
          updated_at?: string
          validated_docket?: string | null
          validated_title?: string | null
          validation_source?: string | null
          verified_at?: string | null
          year?: number | null
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
      _generate_referral_code: { Args: never; Returns: string }
      _plan_credits: { Args: { _plan: string }; Returns: number }
      _plan_period_length: { Args: { _plan: string }; Returns: string }
      _plan_reset_mode: { Args: { _plan: string }; Returns: string }
      add_topup_credits: {
        Args: { _amount: number; _reason?: string; _user_id: string }
        Returns: Json
      }
      bulk_update_legal_chunk_embeddings: {
        Args: { payload: Json }
        Returns: number
      }
      cleanup_email_unsubscribe_tokens: { Args: never; Returns: number }
      compute_verified_source_identity: {
        Args: {
          _full_citation: string
          _source_name: string
          _source_type: string
          _year: string
        }
        Returns: string
      }
      consume_credits: {
        Args: { _amount: number; _reason: string; _request_id: string }
        Returns: Json
      }
      dblink: { Args: { "": string }; Returns: Record<string, unknown>[] }
      dblink_cancel_query: { Args: { "": string }; Returns: string }
      dblink_close: { Args: { "": string }; Returns: string }
      dblink_connect: { Args: { "": string }; Returns: string }
      dblink_connect_u: { Args: { "": string }; Returns: string }
      dblink_current_query: { Args: never; Returns: string }
      dblink_disconnect:
        | { Args: never; Returns: string }
        | { Args: { "": string }; Returns: string }
      dblink_error_message: { Args: { "": string }; Returns: string }
      dblink_exec: { Args: { "": string }; Returns: string }
      dblink_fdw_validator: {
        Args: { catalog: unknown; options: string[] }
        Returns: undefined
      }
      dblink_get_connections: { Args: never; Returns: string[] }
      dblink_get_notify:
        | { Args: { conname: string }; Returns: Record<string, unknown>[] }
        | { Args: never; Returns: Record<string, unknown>[] }
      dblink_get_pkey: {
        Args: { "": string }
        Returns: Database["public"]["CompositeTypes"]["dblink_pkey_results"][]
        SetofOptions: {
          from: "*"
          to: "dblink_pkey_results"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      dblink_get_result: {
        Args: { "": string }
        Returns: Record<string, unknown>[]
      }
      dblink_is_busy: { Args: { "": string }; Returns: number }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      grant_referral_bonus_if_eligible: {
        Args: { _user_id: string }
        Returns: Json
      }
      increment_citation_count: { Args: never; Returns: undefined }
      increment_usage_count: { Args: { source_id: string }; Returns: undefined }
      local_caselaw_body_signals: {
        Args: { _doc_ids: string[] }
        Returns: {
          body_chars: number
          case_number: string
          document_id: string
          head_text: string
        }[]
      }
      match_legal_chunks: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          chunk_content: string
          chunk_id: string
          document_citation: string
          document_id: string
          document_title: string
          metadata: Json
          similarity: number
          source_type: string
          source_url: string
        }[]
      }
      match_legal_chunks_filtered: {
        Args: {
          filter_source_type: string
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          chunk_content: string
          chunk_id: string
          document_citation: string
          document_id: string
          document_title: string
          metadata: Json
          similarity: number
          source_type: string
          source_url: string
        }[]
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      reap_stale_research_jobs: {
        Args: { _absolute_max_age?: string; _max_age?: string }
        Returns: {
          prior_stage: string
          reaped_id: string
          stale_seconds: number
        }[]
      }
      rebuild_hnsw_index: { Args: never; Returns: undefined }
      record_legal_acceptance: { Args: { _version: string }; Returns: Json }
      refund_credits: {
        Args: { _reason: string; _request_id: string }
        Returns: Json
      }
      refund_credits_for_user: {
        Args: { _reason: string; _request_id: string; _user_id: string }
        Returns: Json
      }
      reset_or_renew_credits: { Args: never; Returns: number }
      search_legal_chunks_text: {
        Args: { match_count?: number; search_query: string }
        Returns: {
          chunk_content: string
          chunk_id: string
          document_citation: string
          document_id: string
          document_title: string
          metadata: Json
          similarity: number
          source_type: string
          source_url: string
        }[]
      }
      search_legal_chunks_trigram: {
        Args: {
          match_count?: number
          search_terms: string[]
          similarity_threshold?: number
        }
        Returns: {
          chunk_content: string
          chunk_id: string
          document_citation: string
          document_id: string
          document_title: string
          metadata: Json
          similarity: number
          source_type: string
          source_url: string
        }[]
      }
      search_legal_chunks_tsquery: {
        Args: {
          match_count?: number
          raw_query?: string
          tsq_fallback?: string
          tsq_primary: string
        }
        Returns: {
          chunk_content: string
          chunk_id: string
          document_citation: string
          document_id: string
          document_title: string
          metadata: Json
          similarity: number
          source_type: string
          source_url: string
          tsquery_used: string
        }[]
      }
      set_user_plan: {
        Args: { _new_plan: string; _user_id: string }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      dblink_pkey_results: {
        position: number | null
        colname: string | null
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
