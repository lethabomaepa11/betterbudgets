// Type augmentation for Background Sync API
interface ServiceWorkerRegistration {
  sync: SyncManager;
  periodicSync: PeriodicSyncManager;
}

interface SyncManager {
  register(tag: string): Promise<void>;
}

interface PeriodicSyncManager {
  register(tag: string, options: { minInterval: number }): Promise<void>;
}