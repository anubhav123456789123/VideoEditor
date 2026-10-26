// Library → Motion Graphics: describe a graphic, Claude writes it, preview it,
// then insert it into the timeline or save it to assets/motion-graphics.
//   Remotion     Claude writes an MG component in the editor's template contract;
//                it is previewed with @remotion/player and inserted as an MG clip
//                (editable props, re-renders with the project).
//   HyperFrames  Claude writes a HeyGen HyperFrames composition (HTML + GSAP);
//                it is previewed in a sandboxed iframe and rendered to a
//                transparent video when inserted.
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Tpl } from '../types';
import { prepareTemplate } from '../template-host';
import { HyperframesPreview, RemotionPreview } from './MgPreviews';
import { Icon } from '../components/icons';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { cn } from '../lib/utils';
import { useT } from '../i18n/locale';
import type { MobileUploadRecord } from '../media/mobileUploadApi';
import claudeSvg from '../../assets/vendor-icons/claude-color.svg';
import {
  generateMotionGraphic,
  renderHyperframes,
  saveGeneratedMotionGraphic,
  type GeneratedMotionGraphic,
} from './localAssets';

type Engine = 'remotion' | 'hyperframes';

interface MotionGraphicsStudioProps {
  fps: number;
  width: number;
  height: number;
  onAddTemplate: (tpl: Tpl) => void;
  onAddRenderedMedia: (record: MobileUploadRecord) => Promise<void>;
  onSaved: () => void;
}

const DURATIONS = [3, 5, 8, 12];

// Example prompts are translation keys; rendered through t().
const EXAMPLES: Record<Engine, string[]> = {
  remotion: ['极简下三分之一字幕条：姓名 + 职位', '数字从 0 滚动到 1,000,000 的数据卡', '三个要点逐条出现的清单'],
  hyperframes: ['逐词弹出的大标题“Make it simple.”', '右下角订阅按钮，弹入后轻微跳动', '章节转场：黑底白字“Chapter 2”'],
};

function nameFromPrompt(prompt: string): string {
  const clean = prompt.replace(/\s+/g, ' ').trim();
  return clean.length > 28 ? `${clean.slice(0, 28)}…` : clean || 'Motion graphic';
}

export function MotionGraphicsStudio({ fps, width, height, onAddTemplate, onAddRenderedMedia, onSaved }: MotionGraphicsStudioProps) {
  const t = useT();
  const [engine, setEngine] = useState<Engine>('remotion');
  const [prompt, setPrompt] = useState('');
  const [seconds, setSeconds] = useState(5);
  const [phase, setPhase] = useState<'idle' | 'generating' | 'inserting' | 'saving'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<(GeneratedMotionGraphic & { prompt: string }) | null>(null);
  const [showCode, setShowCode] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const generate = async (refine: boolean) => {
    const text = prompt.trim();
    if (!text) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase('generating');
    setError(null);
    setNotice(null);
    try {
      const next = await generateMotionGraphic({
        engine, prompt: text, width, height, seconds,
        previous: refine && result?.engine === engine ? result.source : undefined,
      }, controller.signal);
      if (next.engine === 'remotion') await prepareTemplate(next.source);
      setResult({ ...next, prompt: refine && result ? `${result.prompt} · ${text}` : text });
      if (refine) setPrompt('');
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abortRef.current === controller) setPhase('idle');
    }
  };

  const insert = async () => {
    if (!result) return;
    setPhase('inserting');
    setError(null);
    try {
      const name = nameFromPrompt(result.prompt);
      if (result.engine === 'remotion') {
        onAddTemplate({
          id: `mg-studio-${crypto.randomUUID()}`,
          name,
          category: '动态图形',
          width: result.width,
          height: result.height,
          fps,
          durationInFrames: Math.max(15, Math.round(result.seconds * fps)),
          props: {},
          propSchema: [],
          thumb: null,
          code: result.source,
        });
      } else {
        await onAddRenderedMedia(await renderHyperframes({ html: result.source, name, fps }));
      }
      setNotice(t('已插入时间线'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhase('idle');
    }
  };

  const save = async () => {
    if (!result) return;
    setPhase('saving');
    setError(null);
    try {
      const meta = result.engine === 'remotion'
        ? { description: result.prompt, durationInFrames: Math.round(result.seconds * fps), width: result.width, height: result.height }
        : { description: result.prompt, durationSeconds: result.seconds, width: result.width, height: result.height };
      await saveGeneratedMotionGraphic({ name: nameFromPrompt(result.prompt), engine: result.engine, source: result.source, meta });
      setNotice(t('已保存到素材库 → MG 动画'));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhase('idle');
    }
  };

  const busy = phase !== 'idle';

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto font-sans">
      <div className="flex flex-col gap-2.5 p-3">
        <div className="flex items-center gap-2">
          <img src={claudeSvg} alt="" aria-hidden className="h-5 w-5 rounded-[5px]" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-foreground">{t('动态图形')}</div>
            <div className="text-[10.5px] text-muted-foreground">{t('描述画面，Claude 生成可直接上轨的动画')}</div>
          </div>
        </div>
        <Tabs value={engine} onValueChange={(value) => { setEngine(value as Engine); setResult(null); }}>
          <TabsList className="w-full">
            <TabsTrigger value="remotion" className="flex-1">Remotion</TabsTrigger>
            <TabsTrigger value="hyperframes" className="flex-1">HyperFrames</TabsTrigger>
          </TabsList>
        </Tabs>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void generate(!!result); } }}
          placeholder={result ? t('描述要修改的地方…') : t('例如：干净的标题卡，白字从下方淡入')}
          rows={3}
          disabled={busy}
        />
        {!result && (
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES[engine].map((example) => (
              <button key={example} type="button" onClick={() => setPrompt(t(example))}
                className="cursor-pointer rounded-full border border-border px-2 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                {t(example)}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
            {DURATIONS.map((value) => (
              <button key={value} type="button" onClick={() => setSeconds(value)} disabled={busy}
                className={cn('cursor-pointer rounded-md px-1.5 py-0.5 tabular-nums transition-colors', seconds === value ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}>
                {value}s
              </button>
            ))}
          </div>
          <span className="flex-1" />
          {phase === 'generating' ? (
            <Button variant="outline" size="sm" onClick={() => abortRef.current?.abort()}>{t('停止')}</Button>
          ) : (
            <Button size="sm" onClick={() => { void generate(!!result); }} disabled={busy || !prompt.trim()}>
              <Icon name="sparkles" size={12} />
              {result ? t('修改') : t('生成')}
            </Button>
          )}
        </div>
      </div>

      <AnimatePresence mode="popLayout">
        {phase === 'generating' && (
          <motion.div key="thinking" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="mx-3 flex items-center gap-2 rounded-lg bg-muted px-3 py-2.5 text-[11.5px] text-muted-foreground">
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-foreground/50"
                  animate={{ opacity: [0.25, 1, 0.25] }} transition={{ repeat: Infinity, duration: 1.1, delay: i * 0.18 }} />
              ))}
            </span>
            {t('Claude 正在编写动画…')}
          </motion.div>
        )}
      </AnimatePresence>

      {error && <p className="mx-3 mt-2 rounded-md bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">{error}</p>}

      <AnimatePresence>
        {result && (
          <motion.div key={result.source.length + result.prompt} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="mx-3 mb-3 mt-2 overflow-hidden rounded-xl border border-border bg-card">
            <div className="relative aspect-video w-full overflow-hidden bg-[repeating-conic-gradient(var(--cc-panel-alt)_0%_25%,var(--cc-panel)_0%_50%)] bg-[length:16px_16px]">
              {result.engine === 'remotion'
                ? <RemotionPreview code={result.source} fps={fps} width={result.width} height={result.height} seconds={result.seconds} />
                : <HyperframesPreview html={result.source} width={result.width} height={result.height} />}
            </div>
            <div className="flex flex-col gap-2 p-2.5">
              <div className="text-[11.5px] leading-snug text-foreground">{result.prompt}</div>
              {result.problems.length > 0 && (
                <ul className="list-disc pl-4 text-[10.5px] text-muted-foreground">
                  {result.problems.slice(0, 4).map((problem) => <li key={problem}>{problem}</li>)}
                </ul>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" onClick={() => { void insert(); }} disabled={busy}>
                  <Icon name="plus" size={12} />
                  {phase === 'inserting' ? (result.engine === 'hyperframes' ? t('渲染中…') : t('插入中…')) : t('插入时间线')}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => { void save(); }} disabled={busy}>
                  <Icon name="bookmark" size={12} />
                  {t('存入素材库')}
                </Button>
                <span className="flex-1" />
                <Button size="sm" variant="ghost" onClick={() => setShowCode((v) => !v)}>{showCode ? t('隐藏代码') : t('查看代码')}</Button>
              </div>
              {notice && <div className="text-[10.5px] text-muted-foreground">{notice}</div>}
              {showCode && (
                <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono text-[10px] leading-relaxed text-foreground">{result.source}</pre>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
