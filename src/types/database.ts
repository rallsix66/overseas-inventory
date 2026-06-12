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
          last_sync_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          variant_id: string
          warehouse_id: string
          quantity?: number
          last_sync_at: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          variant_id?: string
          warehouse_id?: string
          quantity?: number
          last_sync_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      shipment: {
        Row: {
          id: string
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
        }
        Insert: {
          id?: string
          vessel_name: string | null
          voyage_number: string | null
          origin_port: string | null
          destination_port: string | null
          country: string
          warehouse_id: string | null
          status?: string
          estimated_arrival: string | null
          created_by: string
          note: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
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
      sync_log: {
        Row: {
          id: string
          warehouse_id: string
          status: string
          new_variants_count: number
          error_message: string | null
          started_at: string
          finished_at: string
        }
        Insert: {
          id?: string
          warehouse_id: string
          status: string
          new_variants_count?: number
          error_message: string | null
          started_at: string
          finished_at: string
        }
        Update: {
          id?: string
          warehouse_id?: string
          status?: string
          new_variants_count?: number
          error_message?: string | null
          started_at?: string
          finished_at?: string
        }
        Relationships: []
      }
    }
    Views: {}
    Functions: {
      get_user_role: { Args: Record<string, never>; Returns: string }
      batch_match_variants: {
        Args: { p_variant_ids: string[]; p_product_id: string }
        Returns: number
      }
      create_shipment_transactional: {
        Args: {
          p_vessel_name: string | null
          p_voyage_number: string | null
          p_origin_port: string | null
          p_destination_port: string | null
          p_country: string
          p_warehouse_id: string | null
          p_estimated_arrival: string | null
          p_note: string | null
          p_items: Array<{ variant_id: string; quantity: number }>
        }
        Returns: string
      }
    }
    Enums: {}
    CompositeTypes: {}
  }
}
