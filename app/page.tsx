import { EditorMount } from './EditorMount';

// The editor is a browser-only app (WebCodecs, WebGL, OPFS, workers), so the
// page renders an empty mount point and boots it on the client.
export default function Page() {
  return <EditorMount />;
}
