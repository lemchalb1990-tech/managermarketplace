export interface SyncPayload {
  stock: number;
  price?: number;
}

export interface PublishResult {
  externalId: string;
  externalUrl?: string;
}

export interface PlatformAdapter {
  testConnection(conn: any): Promise<{ success: boolean; message?: string }>;
  publishProduct(conn: any, product: any): Promise<PublishResult>;
  syncListing(conn: any, externalId: string, payload: SyncPayload): Promise<void>;
}
