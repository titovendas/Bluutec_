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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      catalog_products: {
        Row: {
          active: boolean
          barcode: string | null
          category: string | null
          code: string
          color: string | null
          created_at: string
          description: string
          family: string | null
          id: string
          image_url: string | null
          ipi_percent: number
          ncm: string | null
          package_qty: number | null
          price_atacado: number | null
          price_table_import_id: string | null
          price_updated_at: string | null
          price_varejo_10: number | null
          price_varejo_75: number | null
          ref: string | null
          st_percent: number
          table_price: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          barcode?: string | null
          category?: string | null
          code: string
          color?: string | null
          created_at?: string
          description: string
          family?: string | null
          id?: string
          image_url?: string | null
          ipi_percent?: number
          ncm?: string | null
          package_qty?: number | null
          price_atacado?: number | null
          price_table_import_id?: string | null
          price_updated_at?: string | null
          price_varejo_10?: number | null
          price_varejo_75?: number | null
          ref?: string | null
          st_percent?: number
          table_price?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          barcode?: string | null
          category?: string | null
          code?: string
          color?: string | null
          created_at?: string
          description?: string
          family?: string | null
          id?: string
          image_url?: string | null
          ipi_percent?: number
          ncm?: string | null
          package_qty?: number | null
          price_atacado?: number | null
          price_table_import_id?: string | null
          price_updated_at?: string | null
          price_varejo_10?: number | null
          price_varejo_75?: number | null
          ref?: string | null
          st_percent?: number
          table_price?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_products_price_table_import_id_fkey"
            columns: ["price_table_import_id"]
            isOneToOne: false
            referencedRelation: "price_table_imports"
            referencedColumns: ["id"]
          }
        ]
      }
      price_table_imports: {
        Row: {
          file_name: string
          id: string
          imported_at: string
          products_count: number
        }
        Insert: {
          file_name: string
          id?: string
          imported_at?: string
          products_count?: number
        }
        Update: {
          file_name?: string
          id?: string
          imported_at?: string
          products_count?: number
        }
        Relationships: []
      }
      product_tax_rates: {
        Row: {
          created_at: string
          id: string
          ipi_percent: number
          product_id: string
          st_percent: number
          uf: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          ipi_percent?: number
          product_id: string
          st_percent?: number
          uf: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          ipi_percent?: number
          product_id?: string
          st_percent?: number
          uf?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_st_rates_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          }
        ]
      }
      customers: {
        Row: {
          address: string | null
          city: string | null
          created_at: string
          customer_type: string
          document: string | null
          email: string | null
          id: string
          name: string
          neighborhood: string | null
          phone: string | null
          price_table: string
          state: string | null
          updated_at: string
          user_id: string
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          customer_type?: string
          document?: string | null
          email?: string | null
          id?: string
          name: string
          neighborhood?: string | null
          phone?: string | null
          price_table?: string
          state?: string | null
          updated_at?: string
          user_id: string
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          customer_type?: string
          document?: string | null
          email?: string | null
          id?: string
          name?: string
          neighborhood?: string | null
          phone?: string | null
          price_table?: string
          state?: string | null
          updated_at?: string
          user_id?: string
          zip_code?: string | null
        }
        Relationships: []
      }
      order_items: {
        Row: {
          catalog_product_id: string | null
          code: string | null
          description: string | null
          discount_percent: number
          id: string
          image_url: string | null
          ipi_percent: number
          ipi_value: number
          order_id: string
          product_id: string | null
          quantity: number
          st_percent: number
          st_value: number
          table_price: number | null
          total: number
          unit_price: number
        }
        Insert: {
          catalog_product_id?: string | null
          code?: string | null
          description?: string | null
          discount_percent?: number
          id?: string
          image_url?: string | null
          ipi_percent?: number
          ipi_value?: number
          order_id: string
          product_id?: string | null
          quantity?: number
          st_percent?: number
          st_value?: number
          table_price?: number | null
          total?: number
          unit_price?: number
        }
        Update: {
          catalog_product_id?: string | null
          code?: string | null
          description?: string | null
          discount_percent?: number
          id?: string
          image_url?: string | null
          ipi_percent?: number
          ipi_value?: number
          order_id?: string
          product_id?: string | null
          quantity?: number
          st_percent?: number
          st_value?: number
          table_price?: number | null
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_catalog_product_id_fkey"
            columns: ["catalog_product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          cash_discount_percent: number
          created_at: string
          customer_id: string | null
          id: string
          ipi_total: number
          payment_term: string | null
          pickup_discount_percent: number
          price_table: string
          seller_id: string | null
          st_total: number
          status: string
          subtotal: number
          total: number
          updated_at: string
          user_id: string
        }
        Insert: {
          cash_discount_percent?: number
          created_at?: string
          customer_id?: string | null
          id?: string
          ipi_total?: number
          payment_term?: string | null
          pickup_discount_percent?: number
          price_table?: string
          seller_id?: string | null
          st_total?: number
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          cash_discount_percent?: number
          created_at?: string
          customer_id?: string | null
          id?: string
          ipi_total?: number
          payment_term?: string | null
          pickup_discount_percent?: number
          price_table?: string
          seller_id?: string | null
          st_total?: number
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_terms: {
        Row: {
          active: boolean
          created_at: string
          id: string
          label: string
          sort_order: number
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          label: string
          sort_order?: number
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          label?: string
          sort_order?: number
          user_id?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          active: boolean
          cost: number | null
          created_at: string
          description: string | null
          id: string
          name: string
          price: number
          sku: string | null
          stock: number
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          cost?: number | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          price?: number
          sku?: string | null
          stock?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          cost?: number | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          price?: number
          sku?: string | null
          stock?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sellers: {
        Row: {
          active: boolean
          created_at: string
          email: string | null
          id: string
          name: string
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      order_summary: {
        Row: {
          calculated_total: number | null
          created_at: string | null
          customer_id: string | null
          customer_name: string | null
          id: string | null
          seller_id: string | null
          seller_name: string | null
          status: string | null
          total: number | null
          updated_at: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
