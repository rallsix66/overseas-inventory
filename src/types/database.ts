// 数据库类型 — 由 migration DDL 自动生成（snake_case）
// 等效命令: npx supabase gen types typescript --linked
// 生成时间: 2026-06-10T09:21:42.732Z
/* eslint-disable @typescript-eslint/no-empty-object-type */

export type Database = {
  public: {
    Tables: {
      role: {
        Row: {
          id: string
          name: string
          description: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          description: string | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          created_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          display_name: string
          role_id: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          display_name: string
          role_id: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          display_name?: string
          role_id?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      product: {
        Row: {
          id: string
          code: string
          name: string
          safety_stock: number
          category: string | null
          unit: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          code: string
          name: string
          safety_stock?: number
          category: string | null
          unit?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          code?: string
          name?: string
          safety_stock?: number
          category?: string | null
          unit?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_variant: {
        Row: {
          id: string
          product_id: string | null
          sku: string
          country: string
          name: string
          match_status: string
          last_sync_at: string | null
          is_archived: boolean
          archived_at: string | null
          archived_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          product_id: string | null
          sku: string
          country: string
          name: string
          match_status?: string
          last_sync_at: string | null
          is_archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          product_id?: string | null
          sku?: string
          country?: string
          name?: string
          match_status?: string
          last_sync_at?: string | null
          is_archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      warehouse: {
        Row: {
          id: string
          name: string
          country: string
          type: string
          is_active: boolean
          sync_url: string | null
          last_sync_at: string | null
          lead_time_days: number | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          country: string
          type: string
          is_active?: boolean
          sync_url: string | null
          last_sync_at: string | null
          lead_time_days?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          country?: string
          type?: string
          is_active?: boolean
          sync_url?: string | null
          last_sync_at?: string | null
          lead_time_days?: number | null
          created_at?: string
        }
        Relationships: []
      }
      inventory: {
        Row: {
          id: string
          variant_id: string
          warehouse_id: string
          quantity: number
          daily_sales: number | null
          estimated_days: number | null
          last_sync_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          variant_id: string
          warehouse_id: string
          quantity?: number
          daily_sales?: number | null
          estimated_days?: number | null
          last_sync_at: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          variant_id?: string
          warehouse_id?: string
          quantity?: number
          daily_sales?: number | null
          estimated_days?: number | null
          last_sync_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      shipment: {
        Row: {
          id: string
          shipment_no: string
          purchase_order_no: string | null
          vessel_name: string | null
          voyage_number: string | null
          origin_port: string | null
          destination_port: string | null
          country: string
          warehouse_id: string | null
          status: string
          estimated_arrival: string | null
          created_by: string
          note: string | null
          created_at: string
          updated_at: string
          bigseller_absorbed_at: string | null
        }
        Insert: {
          id?: string
          shipment_no: string
          purchase_order_no?: string | null
          vessel_name?: string | null
          voyage_number?: string | null
          origin_port?: string | null
          destination_port?: string | null
          country: string
          warehouse_id?: string | null
          status?: string
          estimated_arrival?: string | null
          created_by: string
          note?: string | null
          created_at?: string
          updated_at?: string
          bigseller_absorbed_at?: string | null
        }
        Update: {
          id?: string
          shipment_no?: string
          purchase_order_no?: string | null
          vessel_name?: string | null
          voyage_number?: string | null
          origin_port?: string | null
          destination_port?: string | null
          country?: string
          warehouse_id?: string | null
          status?: string
          estimated_arrival?: string | null
          created_by?: string
          note?: string | null
          created_at?: string
          updated_at?: string
          bigseller_absorbed_at?: string | null
        }
        Relationships: []
      }
      shipment_item: {
        Row: {
          id: string
          shipment_id: string
          variant_id: string
          quantity: number
          warehoused_quantity: number
          created_at: string
        }
        Insert: {
          id?: string
          shipment_id: string
          variant_id: string
          quantity: number
          warehoused_quantity?: number
          created_at?: string
        }
        Update: {
          id?: string
          shipment_id?: string
          variant_id?: string
          quantity?: number
          warehoused_quantity?: number
          created_at?: string
        }
        Relationships: []
      }
      tracking_event: {
        Row: {
          id: string
          shipment_id: string
          status: string
          description: string | null
          occurred_at: string
          created_by: string
          created_at: string
        }
        Insert: {
          id?: string
          shipment_id: string
          status: string
          description: string | null
          occurred_at: string
          created_by: string
          created_at?: string
        }
        Update: {
          id?: string
          shipment_id?: string
          status?: string
          description?: string | null
          occurred_at?: string
          created_by?: string
          created_at?: string
        }
        Relationships: []
      }
      shipment_external_ref: {
        Row: {
          id: string
          provider: string
          external_order_no: string
          waybill_no: string | null
          country: string
          warehouse_id: string | null
          raw_payload: Record<string, unknown>
          sync_status: string
          last_synced_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          provider: string
          external_order_no: string
          waybill_no?: string | null
          country: string
          warehouse_id?: string | null
          raw_payload?: Record<string, unknown>
          sync_status?: string
          last_synced_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          provider?: string
          external_order_no?: string
          waybill_no?: string | null
          country?: string
          warehouse_id?: string | null
          raw_payload?: Record<string, unknown>
          sync_status?: string
          last_synced_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      shipment_external_item: {
        Row: {
          id: string
          external_ref_id: string
          external_sku: string
          external_product_name: string | null
          quantity: number
          matched_variant_id: string | null
          raw_payload: Record<string, unknown>
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          external_ref_id: string
          external_sku: string
          external_product_name?: string | null
          quantity: number
          matched_variant_id?: string | null
          raw_payload?: Record<string, unknown>
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          external_ref_id?: string
          external_sku?: string
          external_product_name?: string | null
          quantity?: number
          matched_variant_id?: string | null
          raw_payload?: Record<string, unknown>
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      tracking_event_external: {
        Row: {
          id: string
          external_ref_id: string
          provider: string
          external_event_id: string | null
          status: string | null
          description: string | null
          occurred_at: string | null
          location: string | null
          raw_payload: Record<string, unknown>
          created_at: string
        }
        Insert: {
          id?: string
          external_ref_id: string
          provider: string
          external_event_id?: string | null
          status?: string | null
          description?: string | null
          occurred_at?: string | null
          location?: string | null
          raw_payload?: Record<string, unknown>
          created_at?: string
        }
        Update: {
          id?: string
          external_ref_id?: string
          provider?: string
          external_event_id?: string | null
          status?: string | null
          description?: string | null
          occurred_at?: string | null
          location?: string | null
          raw_payload?: Record<string, unknown>
          created_at?: string
        }
        Relationships: []
      }
      sync_log: {
        Row: {
          id: string
          sync_run_id: string | null
          warehouse_id: string
          status: string
          new_variants_count: number
          error_message: string | null
          started_at: string
          finished_at: string
        }
        Insert: {
          id?: string
          sync_run_id?: string | null
          warehouse_id: string
          status: string
          new_variants_count?: number
          error_message?: string | null
          started_at: string
          finished_at: string
        }
        Update: {
          id?: string
          sync_run_id?: string | null
          warehouse_id?: string
          status?: string
          new_variants_count?: number
          error_message?: string | null
          started_at?: string
          finished_at?: string
        }
        Relationships: []
      }
      sync_run: {
        Row: {
          id: string
          warehouse_id: string
          mode: string
          status: string
          triggered_by: string
          triggered_from: string
          started_at: string
          finished_at: string | null
          heartbeat_at: string | null
          created_at: string
          exit_code: number | null
          error_message: string | null
          result_summary: Record<string, unknown> | null
          plan_drift_check: string | null
          plan_drift_count: number | null
          plan_drift_differences: unknown[] | null
          dry_run_run_id: string | null
          input_artifact_hash: string | null
          plan_artifact_hash: string | null
          locked_by: string | null
          lease_expires_at: string | null
        }
        Insert: {
          id?: string
          warehouse_id: string
          mode: string
          status?: string
          triggered_by: string
          triggered_from: string
          started_at?: string
          finished_at?: string | null
          heartbeat_at?: string | null
          created_at?: string
          exit_code?: number | null
          error_message?: string | null
          result_summary?: Record<string, unknown> | null
          plan_drift_check?: string | null
          plan_drift_count?: number | null
          plan_drift_differences?: unknown[] | null
          dry_run_run_id?: string | null
          input_artifact_hash?: string | null
          plan_artifact_hash?: string | null
          locked_by?: string | null
          lease_expires_at?: string | null
        }
        Update: {
          id?: string
          warehouse_id?: string
          mode?: string
          status?: string
          triggered_by?: string
          triggered_from?: string
          started_at?: string
          finished_at?: string | null
          heartbeat_at?: string | null
          created_at?: string
          exit_code?: number | null
          error_message?: string | null
          result_summary?: Record<string, unknown> | null
          plan_drift_check?: string | null
          plan_drift_count?: number | null
          plan_drift_differences?: unknown[] | null
          dry_run_run_id?: string | null
          input_artifact_hash?: string | null
          plan_artifact_hash?: string | null
          locked_by?: string | null
          lease_expires_at?: string | null
        }
        Relationships: []
      }
      user_variant_preference: {
        Row: {
          id: string
          user_id: string
          variant_id: string
          preference_type: 'archived' | 'favorited'
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          variant_id: string
          preference_type: 'archived' | 'favorited'
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          variant_id?: string
          preference_type?: 'archived' | 'favorited'
          created_at?: string
        }
        Relationships: []
      }
      user_warehouses: {
        Row: {
          user_id: string
          warehouse_id: string
          created_at: string
        }
        Insert: {
          user_id: string
          warehouse_id: string
          created_at?: string
        }
        Update: {
          user_id?: string
          warehouse_id?: string
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: {}
    Functions: {
      get_assigned_warehouse_ids: { Args: Record<string, never>; Returns: string[] }
      get_user_role: { Args: Record<string, never>; Returns: string }
      update_user_warehouses: {
        Args: { p_user_id: string; p_warehouse_ids: string[] | null }
        Returns: { success: boolean; error?: string }
      }
      batch_match_variants: {
        Args: { p_variant_ids: string[]; p_product_id: string }
        Returns: number
      }
      create_shipment_transactional: {
        Args: {
          p_shipment_no: string
          p_vessel_name: string | null
          p_voyage_number: string | null
          p_origin_port: string | null
          p_destination_port: string | null
          p_country: string
          p_warehouse_id: string | null
          p_estimated_arrival: string | null
          p_note: string | null
          p_purchase_order_no: string | null
          p_items: Array<{ variant_id: string; quantity: number }>
        }
        Returns: string
      }
      change_shipment_status_transactional: {
        Args: {
          p_shipment_id: string
          p_status: string
          p_description: string | null
        }
        Returns: boolean
      }
      warehouse_shipment_transactional: {
        Args: {
          p_shipment_id: string
          p_description: string | null
        }
        Returns: boolean
      }
      partial_warehouse_shipment: {
        Args: {
          p_shipment_id: string
          p_items: Record<string, unknown>[]
          p_description?: string | null
        }
        Returns: Record<string, unknown>
      }
      claim_sync_run: {
        Args: {
          p_warehouse_id: string
          p_mode: string
          p_run_id: string
          p_lease_duration: number
          p_triggered_by: string
          p_triggered_from: string
          p_dry_run_run_id?: string | null
          p_input_artifact_hash?: string | null
          p_plan_artifact_hash?: string | null
        }
        Returns: string | null
      }
      claim_sync_run_system: {
        Args: {
          p_warehouse_id: string
          p_mode: string
          p_run_id: string
          p_lease_duration: number
          p_triggered_by: string
          p_triggered_from: string
          p_input_artifact_hash?: string | null
        }
        Returns: string | null
      }
      release_sync_run: {
        Args: {
          p_run_id: string
          p_status: string
          p_exit_code: number
          p_error_message?: string | null
          p_result_summary?: Record<string, unknown> | null
          p_plan_drift_check?: string | null
          p_plan_drift_count?: number | null
          p_plan_drift_differences?: unknown[] | null
          p_plan_artifact_hash?: string | null
        }
        Returns: undefined
      }
      heartbeat_sync_run: {
        Args: { p_run_id: string; p_lease_duration: number }
        Returns: undefined
      }
      get_sync_runs: {
        Args: { p_warehouse_id?: string | null; p_limit: number }
        Returns: unknown
      }
      get_sync_run_detail: {
        Args: { p_run_id: string }
        Returns: unknown | null
      }
      cleanup_expired_sync_runs: {
        Args: Record<string, never>
        Returns: number
      }
      /** PERF-S1A: 海外库存分页列表 RPC */
      get_overseas_inventory: {
        Args: {
          p_user_id: string
          p_country?: string | null
          p_warehouse_id?: string | null
          p_search?: string | null
          p_stock_status?: string | null
          p_favorited_only?: boolean
          p_page?: number
          p_page_size?: number
        }
        Returns: Record<string, unknown>
      }
      /** PERF-S1A: 海外库存统计 RPC */
      get_overseas_stats: {
        Args: {
          p_user_id: string
          p_country?: string | null
          p_warehouse_id?: string | null
        }
        Returns: Record<string, unknown>
      }
      /** PERF-S1A: 在途 + 已确认到仓聚合 RPC */
      get_in_transit_confirmed_aggregate: {
        Args: {
          p_user_id: string
          p_warehouse_ids?: string[] | null
        }
        Returns: unknown[]
      }
      /** LOW-STOCK-PAGINATION: 低库存查询 RPC（Migration 00028） */
      get_low_stock: {
        Args: {
          p_user_id: string
          p_limit?: number
        }
        Returns: Record<string, unknown>
      }
      update_user_role_protected: {
        Args: {
          p_target_user_id: string
          p_new_role_id: string
          p_operator_user_id: string
        }
        Returns: void
      }
      toggle_user_active_protected: {
        Args: {
          p_target_user_id: string
          p_is_active: boolean
          p_operator_user_id: string
        }
        Returns: void
      }
    }
    Enums: {}
    CompositeTypes: {}
  }
}
