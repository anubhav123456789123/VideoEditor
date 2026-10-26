// Library → Assets: browses the local folders assets/sfx, assets/music,
// assets/transitions and assets/motion-graphics. Every card can be clicked
// (add at the playhead / apply to the selected clip) or dragged onto the
// timeline, through the same library drag payloads the built-in resource
// tabs use, so drops land with identical rules.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Tpl } from '../types';
import type { AudioAsset } from '../audio/library';
import type { TimelineItem, TransitionType } from '../editor/types';
import { customTransitionUniforms, type CustomTransitionDef } from '../gl/customTransitions';
import { Icon } from '../components/icons';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { cn } from '../lib/utils';
import { useT } from '../i18n/locale';
import { setLibraryDrag } from './drag';
import { TransitionThumb } from './TransitionThumb';
import { HyperframesPreview, RemotionPreview } from './MgPreviews';
import type { MobileUploadRecord } from '../media/mobileUploadApi';
import {
  audioSeconds,
  fetchAssetText,
  loadLocalLibrary,
  localAssetPluginId,
  localAudioAsset,
  renderHyperframes,
  type LocalAssetEntry,
  type LocalAssetKind,
} from './localAssets';
import { useLocalLibrary } from './useLocalLibrary';

interface AssetLibraryBrowserProps {
  fps: number;
  selectedItem: TimelineItem | null;
  onAddAudio: (asset: AudioAsset) => void;
  onAddTemplate: (tpl: Tpl) => void;
  onApplyTransition: (type: TransitionType, custom?: { frag: string; uniforms: Record<string, number>; label: string }) => void;
  /** Ingest a server-rendered file into the media pool and place it at the playhead. */
  onAddRenderedMedia: (record: MobileUploadRecord) => Promise<void>;
  /** Bumped by the Motion Graphics tab after it saves a graphic. */
  refreshKey?: number;
}

const KIND_TABS: ReadonlyArray<{ kind: LocalAssetKind; label: string }> = [
  { kind: 'sfx', label: '音效' },
  { kind: 'music', label: '音乐' },
  { kind: 'transitions', label: '转场' },
  { kind: 'motion-graphics', label: 'MG' },
];

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const m = Math.floor(seconds / 60);
  return `${m}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
}

function matches(entry: LocalAssetEntry, query: string): boolean {
  if (!query) return true;
  const hay = `${entry.name} ${entry.category} ${String(entry.meta.description ?? '')}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((token) => hay.includes(token));
}

export function AssetLibraryBrowser({ fps, selectedItem, onAddAudio, onAddTemplate, onApplyTransition, onAddRenderedMedia, refreshKey = 0 }: AssetLibraryBrowserProps) {
  const t = useT();
  const [kind, setKind] = useState<LocalAssetKind>('sfx');
  const { library, templates, transitions, loading, error } = useLocalLibrary();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => loadLocalLibrary(true), []);
  const firstKey = useRef(refreshKey);
  useEffect(() => { if (refreshKey !== firstKey.current) void load(); }, [load, refreshKey]);

  const flash = (text: string, isError = false) => {
    setStatus({ text, error: isError });
    window.setTimeout(() => setStatus((current) => (current?.text === text ? null : current)), isError ? 6000 : 2500);
  };

  const entries = useMemo(() => library[kind].filter((entry) => matches(entry, query)), [library, kind, query]);

  const addHyperframes = async (entry: LocalAssetEntry) => {
    setBusy(entry.id);
    flash(t('正在渲染「{name}」…', { name: entry.name }));
    try {
      const record = await renderHyperframes({ id: entry.id, name: entry.name, fps });
      await onAddRenderedMedia(record);
      flash(t('已添加「{name}」', { name: entry.name }));
    } catch (e) {
      flash(`${t('渲染失败')}：${e instanceof Error ? e.message : String(e)}`, true);
    } finally {
      setBusy(null);
    }
  };

  const applyTransition = (entry: LocalAssetEntry) => {
    const def = transitions[entry.id];
    if (!def || 'error' in def) { flash(def && 'error' in def ? def.error : t('转场未就绪'), true); return; }
    if (!selectedItem || selectedItem.kind === 'audio') { flash(t('先选中后一个画面片段，再应用转场'), true); return; }
    onApplyTransition('custom-shader', { frag: def.frag, uniforms: customTransitionUniforms(def), label: def.label });
    flash(t('已应用「{name}」', { name: entry.name }));
  };

  const addEntry = (entry: LocalAssetEntry) => {
    if (entry.kind === 'sfx' || entry.kind === 'music') {
      onAddAudio(localAudioAsset(entry, fps));
      flash(t('已添加「{name}」', { name: entry.name }));
    } else if (entry.kind === 'transitions') {
      applyTransition(entry);
    } else if (entry.engine === 'hyperframes') {
      void addHyperframes(entry);
    } else {
      const tpl = templates[entry.id];
      if (!tpl) { flash(t('MG 源码加载失败'), true); return; }
      onAddTemplate(tpl);
      flash(t('已添加「{name}」', { name: entry.name }));
    }
  };

  const onDragStart = (event: React.DragEvent, entry: LocalAssetEntry) => {
    if (entry.kind === 'sfx' || entry.kind === 'music') {
      setLibraryDrag(event, { kind: 'sound', id: entry.id, name: entry.name, src: entry.url, seconds: audioSeconds(entry), category: entry.kind === 'music' ? 'music' : 'sfx' });
    } else if (entry.kind === 'transitions') {
      setLibraryDrag(event, { kind: 'transition', id: localAssetPluginId(entry), name: entry.name });
    } else if (entry.engine === 'hyperframes') {
      setLibraryDrag(event, { kind: 'hyperframes', id: entry.id, name: entry.name });
    } else {
      setLibraryDrag(event, { kind: 'template', id: localAssetPluginId(entry), name: entry.name, data: templates[entry.id] });
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col font-sans">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Tabs value={kind} onValueChange={(value) => setKind(value as LocalAssetKind)} className="min-w-0 flex-1">
          <TabsList className="w-full">
            {KIND_TABS.map((tab) => (
              <TabsTrigger key={tab.kind} value={tab.kind} className="flex-1">
                {t(tab.label)}
                <span className="ml-1 text-[10px] text-muted-foreground tabular-nums">{library[tab.kind].length}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button variant="ghost" size="icon" title={t('刷新')} aria-label={t('刷新')} onClick={() => { void load(); }}>
          <motion.span animate={{ rotate: loading ? 360 : 0 }} transition={loading ? { repeat: Infinity, duration: 0.9, ease: 'linear' } : { duration: 0.2 }} className="inline-flex">
            <Icon name="history" size={14} />
          </motion.span>
        </Button>
      </div>
      <div className="px-3 pt-2">
        <div className="relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"><Icon name="search" size={13} /></span>
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('搜索素材')} className="pl-8" />
        </div>
      </div>
      <AnimatePresence>
        {status && (
          <motion.div
            key={status.text}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={cn('mx-3 mt-2 rounded-md px-2.5 py-1.5 text-[11px]', status.error ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground')}
          >
            {status.text}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {error ? (
          <p className="py-6 text-center text-xs text-destructive">{t('素材库读取失败')}：{error}</p>
        ) : !loading && entries.length === 0 ? (
          <div className="py-10 text-center text-xs leading-relaxed text-muted-foreground">
            <p>{query ? t('没有匹配的素材') : t('这个文件夹还是空的')}</p>
            <p className="mt-1 font-mono text-[10.5px]">assets/{kind}/</p>
          </div>
        ) : kind === 'sfx' || kind === 'music' ? (
          <AudioList entries={entries} onAdd={addEntry} onDragStart={onDragStart} />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2">
            {entries.map((entry, index) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index, 12) * 0.02, duration: 0.18 }}
                whileHover={{ y: -2 }}
              >
                <button
                  type="button"
                  draggable
                  onDragStart={(e) => onDragStart(e, entry)}
                  onClick={() => addEntry(entry)}
                  disabled={busy === entry.id}
                  className="group flex w-full cursor-pointer flex-col overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:border-foreground/30 disabled:opacity-60"
                  title={String(entry.meta.description ?? entry.name)}
                >
                  <AssetPreview entry={entry} fps={fps} busy={busy === entry.id} transition={transitions[entry.id]} template={templates[entry.id]} />
                  <div className="px-2 py-1.5">
                    <span className="block truncate text-[11.5px] font-medium text-foreground">{entry.name}</span>
                  </div>
                </button>
              </motion.div>
            ))}
          </div>
        )}
      </div>
      <p className="border-t border-border px-3 py-1.5 text-[10.5px] text-muted-foreground">
        {kind === 'transitions'
          ? t('点击应用到选中片段，或拖到后一个片段上')
          : t('点击添加到播放头，或拖到时间线')}
      </p>
    </div>
  );
}

function AssetPreview({ entry, fps, busy, transition, template }: {
  entry: LocalAssetEntry;
  fps: number;
  busy: boolean;
  transition?: CustomTransitionDef | { error: string };
  template?: Tpl;
}) {
  const [hover, setHover] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    if (!hover || entry.engine !== 'hyperframes' || html !== null) return;
    let alive = true;
    fetchAssetText(entry).then((text) => { if (alive) setHtml(text); }, () => undefined);
    return () => { alive = false; };
  }, [hover, entry, html]);
  if (entry.kind === 'transitions') {
    const ready = transition && !('error' in transition);
    return (
      <div className="relative aspect-video w-full overflow-hidden bg-muted" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        {ready ? <TransitionThumb type={localAssetPluginId(entry)} playing={hover} /> : (
          <div className="flex h-full items-center justify-center text-[10px] text-destructive">{transition && 'error' in transition ? transition.error : '…'}</div>
        )}
      </div>
    );
  }
  const width = Number(entry.meta.width) || 1920;
  const height = Number(entry.meta.height) || 1080;
  return (
    <div
      className="relative aspect-video w-full overflow-hidden bg-[repeating-conic-gradient(var(--cc-panel-alt)_0%_25%,var(--cc-hover)_0%_50%)] bg-[length:12px_12px]"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Previews are visual only: the card button must keep receiving clicks and drags. */}
      {hover && template ? (
        <div className="pointer-events-none absolute inset-0">
          <RemotionPreview code={template.code} fps={fps} width={template.width} height={template.height}
            seconds={template.durationInFrames / template.fps} controls={false} />
        </div>
      ) : hover && html ? (
        <div className="pointer-events-none absolute inset-0">
          <HyperframesPreview html={html} width={width} height={height} />
        </div>
      ) : (
        <div className="flex h-full items-center justify-center">
          <motion.span animate={busy ? { scale: [1, 1.15, 1] } : { scale: 1 }} transition={busy ? { repeat: Infinity, duration: 1 } : undefined} className="text-muted-foreground">
            <Icon name={entry.engine === 'hyperframes' ? 'film' : 'sparkles'} size={20} />
          </motion.span>
        </div>
      )}
      {entry.engine && (
        <span className="absolute left-1.5 top-1.5 rounded-sm bg-background/85 px-1 py-px text-[9.5px] text-muted-foreground backdrop-blur-sm">
          {entry.engine === 'hyperframes' ? 'HyperFrames' : 'Remotion'}
        </span>
      )}
      {busy && <span className="absolute bottom-1 right-1.5 rounded-sm bg-background/85 px-1 text-[9.5px] text-muted-foreground">rendering…</span>}
    </div>
  );
}

function AudioList({ entries, onAdd, onDragStart }: {
  entries: LocalAssetEntry[];
  onAdd: (entry: LocalAssetEntry) => void;
  onDragStart: (event: React.DragEvent, entry: LocalAssetEntry) => void;
}) {
  const t = useT();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => () => { audioRef.current?.pause(); }, []);
  const toggle = (entry: LocalAssetEntry) => {
    if (playing === entry.id) { audioRef.current?.pause(); setPlaying(null); return; }
    audioRef.current?.pause();
    const audio = new Audio(entry.url);
    audio.onended = () => setPlaying((current) => (current === entry.id ? null : current));
    audioRef.current = audio;
    void audio.play().catch(() => setPlaying(null));
    setPlaying(entry.id);
  };
  let lastCategory: string | null = null;
  return (
    <div className="flex flex-col">
      {entries.map((entry) => {
        const header = entry.category !== lastCategory ? entry.category : null;
        lastCategory = entry.category;
        return (
          <div key={entry.id}>
            {header !== null && header !== '' && (
              <div className="px-1 pb-1 pt-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{header}</div>
            )}
            <div
              draggable
              onDragStart={(e) => onDragStart(e, entry)}
              className="group flex h-10 cursor-grab items-center gap-2.5 rounded-md px-1.5 hover:bg-accent active:cursor-grabbing"
            >
              <button
                type="button"
                onClick={() => toggle(entry)}
                aria-label={playing === entry.id ? t('暂停') : t('播放')}
                className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
              >
                <Icon name={playing === entry.id ? 'pause' : 'play'} size={11} />
              </button>
              <span className="min-w-0 flex-1 truncate text-xs text-foreground">{entry.name}</span>
              <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">{formatSeconds(audioSeconds(entry))}</span>
              <Button variant="ghost" size="icon" onClick={() => onAdd(entry)} aria-label={t('添加到时间线')} title={t('添加到时间线')} className="opacity-60 group-hover:opacity-100">
                <Icon name="plus" size={13} />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
