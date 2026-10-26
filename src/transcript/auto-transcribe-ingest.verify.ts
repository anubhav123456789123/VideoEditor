import assert from 'node:assert/strict';

// The auto-transcribe ingest policy lives in localStorage (mirror of the
// keystore setting). jsdom-free: drive the pure decision functions with an
// injected storage shim, mirroring provider.ts's localStorage access.
class FakeStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

const storage = new FakeStorage();
(globalThis as unknown as { localStorage: FakeStorage }).localStorage = storage;

const { autoTranscribeIngestSetting, shouldAutoTranscribeIngest, setAutoTranscribeIngest, AUTO_TRANSCRIBE_INGEST_KEY } =
  await import('./provider');

// Default: the local engine auto-transcribes.
storage.removeItem(AUTO_TRANSCRIBE_INGEST_KEY);
assert.equal(autoTranscribeIngestSetting(), 'local', 'default is local');
assert.equal(shouldAutoTranscribeIngest('local'), true, 'local engine auto by default');

// off: nothing auto-transcribes.
setAutoTranscribeIngest('off');
assert.equal(autoTranscribeIngestSetting(), 'off');
assert.equal(shouldAutoTranscribeIngest('local'), false, 'off blocks local');

// all: the local engine auto-transcribes.
setAutoTranscribeIngest('all');
assert.equal(shouldAutoTranscribeIngest('local'), true);

// local: the local engine auto-transcribes.
setAutoTranscribeIngest('local');
assert.equal(shouldAutoTranscribeIngest('local'), true);

// Garbage values degrade to the default instead of crashing.
storage.setItem(AUTO_TRANSCRIBE_INGEST_KEY, 'garbage');
assert.equal(autoTranscribeIngestSetting(), 'local', 'garbage falls back to local');
storage.setItem(AUTO_TRANSCRIBE_INGEST_KEY, 'OFF');
assert.equal(autoTranscribeIngestSetting(), 'local', 'case-sensitive, falls back to local');

console.log('auto-transcribe-ingest.verify: policy decisions passed');
