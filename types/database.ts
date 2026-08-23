// Tipos manuais espelhando supabase/schema.sql.
// Substitua por `npx supabase gen types typescript --project-id <ID> > types/database.ts`
// assim que o projeto Supabase estiver criado, para manter isto sincronizado.

export type AccountPlan = 'essencial' | 'avancado' | 'premium'
export type MembershipRole = 'owner' | 'admin' | 'member'
export type MembershipStatus = 'pending' | 'active' | 'suspended'
export type AppointmentType = 'consulta' | 'retorno' | 'avaliacao' | 'procedimento' | 'outro'
export type AppointmentSource = 'bot' | 'manual' | 'importado'
export type AppointmentStatus = 'agendado' | 'confirmado' | 'realizado' | 'cancelado' | 'no_show'
export type ConversationStatus = 'open' | 'resolved' | 'handoff'
export type MessageRole = 'user' | 'assistant' | 'system'
export type AvailabilityExceptionType = 'blocked' | 'extra'
export type WaitlistStatus = 'waiting' | 'scheduled' | 'cancelled'
export type RevenueStatus = 'previsto' | 'confirmado' | 'cancelado'
export type AdChannel = 'instagram' | 'google' | 'facebook' | 'tiktok' | 'outro'
export type NumberSource = 'own' | 'medscale'
export type OnboardingStep =
  | 'pending'
  | 'meta_app_created'
  | 'number_added'
  | 'webhook_set'
  | 'verified'
  | 'provisioning'
  | 'active'
export type HandoffTriggerReason = 'user_request' | 'bot_uncertain' | 'max_turns' | 'out_of_hours'

// Módulos controláveis por account/membership. dashboard, patients e
// settings são sempre tratados como ativos pelo app (ver lib/session/server.ts).
export type ModuleSlug =
  | 'dashboard'
  | 'agenda'
  | 'conversations'
  | 'locations'
  | 'schedule'
  | 'waitlist'
  | 'financial'
  | 'campaigns'
  | 'patients'
  | 'settings'

export interface Database {
  public: {
    Tables: {
      accounts: {
        Row: {
          id: string
          name: string
          slug: string
          plan: AccountPlan
          is_active: boolean
          modules: ModuleSlug[]
          max_workspaces: number
          max_members: number
          billing_email: string | null
          billing_ref: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['accounts']['Row']> & { name: string; slug: string }
        Update: Partial<Database['public']['Tables']['accounts']['Row']>
        Relationships: []
      }
      workspaces: {
        Row: {
          id: string
          account_id: string
          name: string
          slug: string
          address: string | null
          city: string | null
          state: string | null
          zip_code: string | null
          whatsapp_number: string | null
          phone_number_id: string | null
          meta_token: string | null
          meta_app_secret: string | null
          is_active: boolean
          is_default: boolean
          display_order: number
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['workspaces']['Row']> & { account_id: string; name: string; slug: string }
        Update: Partial<Database['public']['Tables']['workspaces']['Row']>
        Relationships: [
          {
            foreignKeyName: 'workspaces_account_id_fkey'
            columns: ['account_id']
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          },
        ]
      }
      memberships: {
        Row: {
          id: string
          account_id: string
          user_id: string
          role: MembershipRole
          module_overrides: ModuleSlug[] | null
          workspace_ids: string[] | null
          invited_by: string | null
          invited_at: string
          accepted_at: string | null
          status: MembershipStatus
        }
        Insert: Partial<Database['public']['Tables']['memberships']['Row']> & { account_id: string; user_id: string }
        Update: Partial<Database['public']['Tables']['memberships']['Row']>
        Relationships: [
          {
            foreignKeyName: 'memberships_account_id_fkey'
            columns: ['account_id']
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          },
        ]
      }
      invites: {
        Row: {
          id: string
          account_id: string
          email: string
          role: MembershipRole
          token: string
          invited_by: string | null
          expires_at: string
          accepted_at: string | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['invites']['Row']> & { account_id: string; email: string }
        Update: Partial<Database['public']['Tables']['invites']['Row']>
        Relationships: [
          {
            foreignKeyName: 'invites_account_id_fkey'
            columns: ['account_id']
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          },
        ]
      }
      medscale_admins: {
        Row: { user_id: string; created_at: string }
        Insert: { user_id: string; created_at?: string }
        Update: Partial<{ user_id: string; created_at: string }>
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          full_name: string
          email: string | null
          avatar_url: string | null
          phone: string | null
          crm: string | null
          specialty: string | null
          last_workspace_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['profiles']['Row']> & { id: string; full_name: string }
        Update: Partial<Database['public']['Tables']['profiles']['Row']>
        Relationships: [
          {
            foreignKeyName: 'profiles_last_workspace_id_fkey'
            columns: ['last_workspace_id']
            referencedRelation: 'workspaces'
            referencedColumns: ['id']
          },
        ]
      }
      patients: {
        Row: {
          id: string
          account_id: string
          full_name: string
          phone: string
          email: string | null
          birth_date: string | null
          notes: string | null
          tags: string[]
          created_by: string | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['patients']['Row']> & {
          account_id: string
          full_name: string
          phone: string
        }
        Update: Partial<Database['public']['Tables']['patients']['Row']>
        Relationships: [
          {
            foreignKeyName: 'patients_account_id_fkey'
            columns: ['account_id']
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          },
        ]
      }
      appointments: {
        Row: {
          id: string
          workspace_id: string
          account_id: string
          doctor_id: string | null
          patient_id: string | null
          patient_name: string
          patient_phone: string
          scheduled_at: string
          duration_min: number
          type: AppointmentType
          source: AppointmentSource
          status: AppointmentStatus
          notes: string | null
          price: number | null
          gcal_event_id: string | null
          reminder_sent: boolean
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['appointments']['Row']> & {
          workspace_id: string
          account_id: string
          patient_name: string
          patient_phone: string
          scheduled_at: string
        }
        Update: Partial<Database['public']['Tables']['appointments']['Row']>
        Relationships: [
          {
            foreignKeyName: 'appointments_workspace_id_fkey'
            columns: ['workspace_id']
            referencedRelation: 'workspaces'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'appointments_patient_id_fkey'
            columns: ['patient_id']
            referencedRelation: 'patients'
            referencedColumns: ['id']
          },
        ]
      }
      conversations: {
        Row: {
          id: string
          workspace_id: string
          account_id: string
          patient_id: string | null
          patient_phone: string
          status: ConversationStatus
          appointment_id: string | null
          started_at: string
          resolved_at: string | null
          summary: string | null
        }
        Insert: Partial<Database['public']['Tables']['conversations']['Row']> & {
          workspace_id: string
          account_id: string
          patient_phone: string
        }
        Update: Partial<Database['public']['Tables']['conversations']['Row']>
        Relationships: [
          {
            foreignKeyName: 'conversations_workspace_id_fkey'
            columns: ['workspace_id']
            referencedRelation: 'workspaces'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'conversations_patient_id_fkey'
            columns: ['patient_id']
            referencedRelation: 'patients'
            referencedColumns: ['id']
          },
        ]
      }
      messages: {
        Row: {
          id: string
          conversation_id: string
          role: MessageRole
          content: string
          whatsapp_id: string | null
          sent_at: string
        }
        Insert: Partial<Database['public']['Tables']['messages']['Row']> & {
          conversation_id: string
          role: MessageRole
          content: string
        }
        Update: Partial<Database['public']['Tables']['messages']['Row']>
        Relationships: [
          {
            foreignKeyName: 'messages_conversation_id_fkey'
            columns: ['conversation_id']
            referencedRelation: 'conversations'
            referencedColumns: ['id']
          },
        ]
      }
      availability_rules: {
        Row: {
          id: string
          workspace_id: string
          doctor_id: string
          day_of_week: number
          start_time: string
          end_time: string
          slot_duration: number
          is_active: boolean
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['availability_rules']['Row']> & {
          workspace_id: string
          doctor_id: string
          day_of_week: number
          start_time: string
          end_time: string
        }
        Update: Partial<Database['public']['Tables']['availability_rules']['Row']>
        Relationships: [
          {
            foreignKeyName: 'availability_rules_workspace_id_fkey'
            columns: ['workspace_id']
            referencedRelation: 'workspaces'
            referencedColumns: ['id']
          },
        ]
      }
      availability_exceptions: {
        Row: {
          id: string
          workspace_id: string
          doctor_id: string
          date: string
          type: AvailabilityExceptionType
          start_time: string | null
          end_time: string | null
          reason: string | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['availability_exceptions']['Row']> & {
          workspace_id: string
          doctor_id: string
          date: string
          type: AvailabilityExceptionType
        }
        Update: Partial<Database['public']['Tables']['availability_exceptions']['Row']>
        Relationships: [
          {
            foreignKeyName: 'availability_exceptions_workspace_id_fkey'
            columns: ['workspace_id']
            referencedRelation: 'workspaces'
            referencedColumns: ['id']
          },
        ]
      }
      waitlist: {
        Row: {
          id: string
          workspace_id: string
          account_id: string
          patient_id: string | null
          patient_name: string
          patient_phone: string
          doctor_id: string | null
          preferred_days: string[] | null
          preferred_times: string[] | null
          notes: string | null
          status: WaitlistStatus
          notified_at: string | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['waitlist']['Row']> & {
          workspace_id: string
          account_id: string
          patient_name: string
          patient_phone: string
        }
        Update: Partial<Database['public']['Tables']['waitlist']['Row']>
        Relationships: [
          {
            foreignKeyName: 'waitlist_workspace_id_fkey'
            columns: ['workspace_id']
            referencedRelation: 'workspaces'
            referencedColumns: ['id']
          },
        ]
      }
      revenue_entries: {
        Row: {
          id: string
          workspace_id: string
          account_id: string
          appointment_id: string | null
          amount: number
          status: RevenueStatus
          payment_method: string | null
          notes: string | null
          entry_date: string
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['revenue_entries']['Row']> & {
          workspace_id: string
          account_id: string
          amount: number
        }
        Update: Partial<Database['public']['Tables']['revenue_entries']['Row']>
        Relationships: [
          {
            foreignKeyName: 'revenue_entries_workspace_id_fkey'
            columns: ['workspace_id']
            referencedRelation: 'workspaces'
            referencedColumns: ['id']
          },
        ]
      }
      ad_campaigns: {
        Row: {
          id: string
          workspace_id: string
          account_id: string
          channel: AdChannel
          campaign_name: string | null
          period_start: string
          period_end: string
          spend: number
          impressions: number
          clicks: number
          leads: number
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['ad_campaigns']['Row']> & {
          workspace_id: string
          account_id: string
          channel: AdChannel
          period_start: string
          period_end: string
        }
        Update: Partial<Database['public']['Tables']['ad_campaigns']['Row']>
        Relationships: [
          {
            foreignKeyName: 'ad_campaigns_workspace_id_fkey'
            columns: ['workspace_id']
            referencedRelation: 'workspaces'
            referencedColumns: ['id']
          },
        ]
      }
      bot_config: {
        Row: {
          id: string
          workspace_id: string
          account_id: string
          bot_name: string
          specialty: string | null
          procedures: string[]
          insurance_plans: string[]
          accepts_private: boolean
          consultation_price_from: number | null
          business_hours: string | null
          address: string | null
          directions_parking: string | null
          contact_info: string | null
          payment_methods: string[]
          pricing_info: string | null
          exam_preparation: string | null
          policies: string | null
          tone_of_voice: string | null
          handoff_instructions: string | null
          forbidden_actions: string | null
          faq: { question: string; answer: string }[]
          handoff_number: string | null
          handoff_message: string
          welcome_message: string
          out_of_hours_message: string
          is_active: boolean
          number_source: NumberSource
          onboarding_step: OnboardingStep
          webhook_verify_token: string
          provisioning_request: Record<string, unknown> | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['bot_config']['Row']> & { workspace_id: string; account_id: string }
        Update: Partial<Database['public']['Tables']['bot_config']['Row']>
        Relationships: [
          {
            foreignKeyName: 'bot_config_workspace_id_fkey'
            columns: ['workspace_id']
            referencedRelation: 'workspaces'
            referencedColumns: ['id']
          },
        ]
      }
      google_tokens: {
        Row: {
          id: string
          workspace_id: string
          doctor_id: string
          access_token: string
          refresh_token: string
          token_expiry: string
          calendar_id: string
          google_email: string | null
          connected_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['google_tokens']['Row']> & {
          workspace_id: string
          doctor_id: string
          access_token: string
          refresh_token: string
          token_expiry: string
        }
        Update: Partial<Database['public']['Tables']['google_tokens']['Row']>
        Relationships: [
          {
            foreignKeyName: 'google_tokens_workspace_id_fkey'
            columns: ['workspace_id']
            referencedRelation: 'workspaces'
            referencedColumns: ['id']
          },
        ]
      }
      webhook_logs: {
        Row: {
          id: string
          workspace_id: string | null
          payload: Record<string, unknown>
          processed: boolean
          error: string | null
          received_at: string
        }
        Insert: Partial<Database['public']['Tables']['webhook_logs']['Row']> & { payload: Record<string, unknown> }
        Update: Partial<Database['public']['Tables']['webhook_logs']['Row']>
        Relationships: [
          {
            foreignKeyName: 'webhook_logs_workspace_id_fkey'
            columns: ['workspace_id']
            referencedRelation: 'workspaces'
            referencedColumns: ['id']
          },
        ]
      }
      handoff_logs: {
        Row: {
          id: string
          workspace_id: string
          conversation_id: string | null
          patient_phone: string
          trigger_reason: HandoffTriggerReason | null
          handoff_to: string | null
          sent_at: string
        }
        Insert: Partial<Database['public']['Tables']['handoff_logs']['Row']> & { workspace_id: string; patient_phone: string }
        Update: Partial<Database['public']['Tables']['handoff_logs']['Row']>
        Relationships: [
          {
            foreignKeyName: 'handoff_logs_workspace_id_fkey'
            columns: ['workspace_id']
            referencedRelation: 'workspaces'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'handoff_logs_conversation_id_fkey'
            columns: ['conversation_id']
            referencedRelation: 'conversations'
            referencedColumns: ['id']
          },
        ]
      }
      handoff_hours: {
        Row: {
          id: string
          workspace_id: string
          day_of_week: number
          start_time: string
          end_time: string
          is_active: boolean
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['handoff_hours']['Row']> & {
          workspace_id: string
          day_of_week: number
          start_time: string
          end_time: string
        }
        Update: Partial<Database['public']['Tables']['handoff_hours']['Row']>
        Relationships: [
          {
            foreignKeyName: 'handoff_hours_workspace_id_fkey'
            columns: ['workspace_id']
            referencedRelation: 'workspaces'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: Record<string, never>
    Functions: {
      my_account_ids: { Args: Record<string, never>; Returns: string[] }
      my_workspace_ids: { Args: Record<string, never>; Returns: string[] }
      is_account_admin: { Args: { p_account_id: string }; Returns: boolean }
      is_medscale_admin: { Args: Record<string, never>; Returns: boolean }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
