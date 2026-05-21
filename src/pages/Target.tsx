import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../lib/useAuth';
import { motion, AnimatePresence } from 'motion/react';
import { Trash2, Search, Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { STOCKS } from '../lib/stocks';

interface WatchlistItem {
  id: string;
  ticker: string;
  status: string;
  sentiment?: string;
  political_sentiment?: string;
  time_horizon?: string;
  data_quality?: string;
  reasoning?: string;
  analysis_count?: number;
  experimental_mode?: boolean;
}

const SENTIMENT_COLOR: Record<string, string> = {
  Bullish: 'oklch(0.48 0.14 145)',
  Bearish: 'oklch(0.52 0.14 28)',
  Neutral: 'var(--muted)',
};

export function Target() {
  const { user, loading, isConnected } = useAuth();
  const [query, setQuery]             = useState('');
  const [suggestions, setSuggestions] = useState<typeof STOCKS>([]);
  const [showSugg, setShowSugg]       = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [scanError, setScanError]     = useState<string | null>(null);
  const [watchlist, setWatchlist]     = useState<WatchlistItem[]>([]);
  const [selected, setSelected]       = useState<WatchlistItem | null>(null);
  const [fetching, setFetching]       = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  /* ── autocomplete ─────────────────────────────────────── */
  useEffect(() => {
    const q = query.trim().toUpperCase();
    if (!q) { setSuggestions([]); return; }
    setSuggestions(STOCKS.filter(s =>
      s.ticker.startsWith(q) || s.name.toUpperCase().includes(q)
    ).slice(0, 6));
  }, [query]);

  /* ── realtime watchlist ───────────────────────────────── */
  const fetchWatchlist = async () => {
    if (!supabase || !user) return;
    const { data } = await supabase
      .from('watchlist').select('*').eq('user_id', user.id)
      .order('last_updated', { ascending: false });
    if (data) {
      setWatchlist(data);
      setSelected(prev => prev ? (data.find(w => w.id === prev.id) ?? null) : null);
    }
    setFetching(false);
  };

  useEffect(() => {
    if (!user) { setFetching(false); return; }
    if (!supabase) { setFetching(false); return; }
    fetchWatchlist();
    let active = true;
    const ch = supabase
      .channel(`target-${user.id}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'watchlist', filter: `user_id=eq.${user.id}` },
        () => { if (active) fetchWatchlist(); })
      .subscribe();
    return () => { active = false; supabase.removeChannel(ch); };
  }, [user?.id]);

  /* ── add ticker ───────────────────────────────────────── */
  const addTicker = async (ticker: string) => {
    if (!ticker.trim() || !supabase || !user) return;
    const t = ticker.trim().toUpperCase();
    if (watchlist.find(w => w.ticker === t)) { setQuery(''); setShowSugg(false); return; }

    setSubmitting(true);
    setScanError(null);
    setQuery('');
    setShowSugg(false);

    const { data, error } = await supabase
      .from('watchlist').insert([{ ticker: t, user_id: user.id, status: 'scanning' }])
      .select().single();

    if (error) { console.error(error); setSubmitting(false); return; }

    if (data) {
      setSelected(data);
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: data.ticker, user_id: user.id, row_id: data.id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setScanError(err.error ?? `Backend error (${res.status}). Check Worker secrets in Cloudflare.`);
        await supabase.from('watchlist').update({ status: 'idle' }).eq('id', data.id);
      }
      await fetchWatchlist();
    }
    setSubmitting(false);
  };

  const deleteTicker = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!supabase) return;
    await supabase.from('watchlist').delete().eq('id', id);
    if (selected?.id === id) setSelected(null);
    setWatchlist(prev => prev.filter(w => w.id !== id));
  };

  const reScan = async (item: WatchlistItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!supabase || !user) return;
    setScanError(null);
    await supabase.from('watchlist').update({ status: 'scanning' }).eq('id', item.id);
    setSelected({ ...item, status: 'scanning' });
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: item.ticker, user_id: user.id, row_id: item.id, experimental_mode: item.experimental_mode }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setScanError(err.error ?? `Backend error (${res.status}). Check Worker secrets.`);
      await supabase.from('watchlist').update({ status: 'idle' }).eq('id', item.id);
    }
    await fetchWatchlist();
  };

  /* ── guards ───────────────────────────────────────────── */
  if (loading || fetching) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 10, fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '.18em', color: 'var(--muted)', textTransform: 'uppercase' }}>
      <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (isConnected && !user) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '.18em', color: 'var(--muted)', textTransform: 'uppercase' }}>
      Sign in to track targets
    </div>
  );

  const isScanning = (item: WatchlistItem) => item.status === 'scanning';

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 'clamp(100px,14vw,160px) clamp(20px,6vw,64px) 140px' }}>

      {/* ── Search ─────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        style={{ maxWidth: 560, marginBottom: 64, position: 'relative' }}>
        <div style={{ marginBottom: 10, fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--muted)' }}>
          Input Target
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', background: 'rgba(250,250,247,.9)', backdropFilter: 'blur(20px)', border: '1px solid rgba(10,10,10,.12)', borderRadius: 14, boxShadow: '0 2px 16px rgba(10,10,10,.04)' }}>
          <Search size={15} style={{ color: 'var(--muted)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setShowSugg(true); }}
            onKeyDown={e => { if (e.key === 'Enter' && query.trim()) addTicker(query); if (e.key === 'Escape') setShowSugg(false); }}
            onFocus={() => setShowSugg(true)}
            onBlur={() => setTimeout(() => setShowSugg(false), 150)}
            placeholder="Ticker or company name…"
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontFamily: 'var(--f-mono)', fontSize: 13, fontWeight: 500, letterSpacing: '.08em', color: 'var(--ink)' }}
          />
          {query.trim() && (
            <button onClick={() => addTicker(query)} disabled={submitting}
              style={{ padding: '7px 18px', background: 'var(--accent)', color: 'var(--paper)', border: 'none', borderRadius: 999, cursor: submitting ? 'default' : 'pointer', fontFamily: 'var(--f-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase', opacity: submitting ? .5 : 1, whiteSpace: 'nowrap' }}>
              {submitting ? '…' : 'Scan →'}
            </button>
          )}
        </div>

        <AnimatePresence>
          {showSugg && suggestions.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: 0.12 }}
              style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 100, background: 'rgba(250,250,247,.97)', backdropFilter: 'blur(24px)', border: '1px solid rgba(10,10,10,.1)', borderRadius: 10, boxShadow: '0 12px 40px rgba(10,10,10,.08)', overflow: 'hidden' }}>
              {suggestions.map(s => (
                <button key={s.ticker} onMouseDown={() => addTicker(s.ticker)}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', padding: '11px 18px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(10,10,10,.04)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                  <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, fontWeight: 600, letterSpacing: '.1em', color: 'var(--ink)', minWidth: 52 }}>{s.ticker}</span>
                  <span style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {scanError && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 14px', background: 'oklch(0.97 0.02 28)', border: '1px solid oklch(0.85 0.06 28)', borderRadius: 8 }}>
            <AlertCircle size={13} style={{ color: 'oklch(0.52 0.14 28)', marginTop: 1, flexShrink: 0 }} />
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '.08em', color: 'oklch(0.38 0.14 28)', lineHeight: 1.5 }}>{scanError}</span>
          </div>
        )}
      </motion.div>

      {/* ── Split panel ─────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: watchlist.length ? '320px 1fr' : '1fr', gap: 48, alignItems: 'start' }}>

        {/* LEFT: watchlist */}
        {watchlist.length > 0 && (
          <div>
            <div style={{ paddingBottom: 12, borderBottom: '1px solid var(--ink)', marginBottom: 8, display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '.18em', textTransform: 'uppercase' }}>
              <span style={{ color: 'var(--ink)' }}>Watchlist</span>
              <span style={{ color: 'var(--muted)' }}>{watchlist.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {watchlist.map(item => {
                const active = selected?.id === item.id;
                const sc = isScanning(item);
                return (
                  <button key={item.id} onClick={() => setSelected(item)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 8px', borderBottom: '1px solid var(--rule)', background: active ? 'rgba(10,10,10,.04)' : 'none', border: 'none', cursor: 'pointer', textAlign: 'left', borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent', paddingLeft: active ? 14 : 8, transition: 'all .2s var(--e-ease)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontFamily: 'var(--f-mono)', fontSize: 13, fontWeight: 600, letterSpacing: '.12em', color: 'var(--ink)' }}>{item.ticker}</span>
                      {sc ? (
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', animation: 'pdot 1.2s ease-in-out infinite', flexShrink: 0 }} />
                      ) : item.sentiment ? (
                        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 8, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase', color: SENTIMENT_COLOR[item.sentiment] ?? 'var(--muted)' }}>{item.sentiment}</span>
                      ) : null}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <button onClick={e => reScan(item, e)} title="Re-scan" disabled={sc}
                        style={{ color: 'var(--muted-2)', background: 'none', border: 'none', cursor: sc ? 'default' : 'pointer', opacity: sc ? .4 : 1, padding: 4, display: 'flex', borderRadius: 4 }}>
                        <RefreshCw size={11} />
                      </button>
                      <button onClick={e => deleteTicker(item.id, e)} title="Remove"
                        style={{ color: 'var(--muted-2)', background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', borderRadius: 4 }}
                        onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = 'oklch(0.52 0.14 28)')}
                        onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = 'var(--muted-2)')}>
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* RIGHT: analysis panel */}
        <AnimatePresence mode="wait">
          {selected ? (
            <motion.div key={selected.id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>
              {isScanning(selected) ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '40px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }} />
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--accent)' }}>Analysing {selected.ticker}…</span>
                  </div>
                  <div style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--muted)', lineHeight: 1.65, maxWidth: 400 }}>
                    Ingesting SEC filings, congressional trades, and research signals. This takes ~30 seconds.
                  </div>
                </div>
              ) : selected.reasoning ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 20, paddingBottom: 20, borderBottom: '1px solid var(--rule)' }}>
                    <span style={{ fontFamily: 'var(--f-display)', fontSize: 48, fontWeight: 400, letterSpacing: '-.02em', color: 'var(--ink)', lineHeight: 1 }}>{selected.ticker}</span>
                    {selected.sentiment && (
                      <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: SENTIMENT_COLOR[selected.sentiment] ?? 'var(--muted)' }}>{selected.sentiment}</span>
                    )}
                  </div>

                  {/* Meta chips */}
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {[
                      { label: 'Political', value: selected.political_sentiment },
                      { label: 'Horizon',   value: selected.time_horizon },
                      { label: 'Quality',   value: selected.data_quality },
                      { label: 'Scans',     value: selected.analysis_count?.toString() },
                    ].filter(m => m.value).map(m => (
                      <div key={m.label} style={{ padding: '6px 14px', background: 'rgba(10,10,10,.04)', border: '1px solid var(--rule)', borderRadius: 999 }}>
                        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--muted)' }}>{m.label} · </span>
                        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink)' }}>{m.value}</span>
                      </div>
                    ))}
                  </div>

                  {/* Reasoning */}
                  <div style={{ padding: '24px 28px', background: 'rgba(10,10,10,.025)', border: '1px solid var(--rule)', borderRadius: 12 }}>
                    <p style={{ fontFamily: 'var(--f-body)', fontSize: 15, lineHeight: 1.8, color: 'var(--ink-2)', margin: 0, whiteSpace: 'pre-line' }}>
                      {selected.reasoning}
                    </p>
                  </div>

                  <div style={{ fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '.14em', color: 'var(--muted-2)', textTransform: 'uppercase' }}>
                    Select a ticker from the watchlist to view its analysis. Go to See Data for charts and quant metrics.
                  </div>
                </div>
              ) : (
                <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '.14em', color: 'var(--muted)', textTransform: 'uppercase', paddingTop: 40 }}>
                  No analysis yet — click ↺ to scan.
                </div>
              )}
            </motion.div>
          ) : watchlist.length === 0 ? (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ paddingTop: 8 }}>
              <p style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--muted-2)', letterSpacing: '.1em' }}>Search a ticker above to begin.</p>
            </motion.div>
          ) : (
            <motion.div key="pick" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ paddingTop: 40 }}>
              <p style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '.12em', textTransform: 'uppercase' }}>← Select a target to see analysis</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <style>{`
        @keyframes spin  { to { transform: rotate(360deg); } }
        @keyframes pdot  { 0%,100%{opacity:1} 50%{opacity:.25} }
        @media (max-width: 700px) {
          .target-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
