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
  // Pausar (active=false) / activar la publicación en el canal, si el canal lo permite.
  setListingStatus?(conn: any, externalId: string, active: boolean): Promise<void>;
  // Borrar la publicación en la tienda (no solo el vínculo), si el canal lo permite.
  deleteRemoteListing?(conn: any, externalId: string): Promise<void>;
}
