import { useEffect, useSyncExternalStore } from 'react';
import { loadLocalLibrary, localLibrarySnapshot, subscribeLocalLibrary, type LocalLibrarySnapshot } from './localAssets';

/** Subscribe to the shared local asset library; the first subscriber triggers the load. */
export function useLocalLibrary(): LocalLibrarySnapshot {
  const value = useSyncExternalStore(subscribeLocalLibrary, localLibrarySnapshot, localLibrarySnapshot);
  useEffect(() => { void loadLocalLibrary(); }, []);
  return value;
}
