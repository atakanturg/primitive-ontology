import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../lib/useAuth';
import { motion, AnimatePresence } from 'motion/react';
import { Trash2, Search, Loader2 } from 'lucide-react';
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
  Bullish:  'oklch(0.52 0.14 145)',
  Bearish:  'oklch(0.52 0.14 28)',
  Neutral:  'var(--muted)',
};

export function Target() {
  const { user, loading, isConnected } = useAuth();
  const [query, setQuery]           = useState('');
  const [suggestions, setSuggestions] = useState<typeof STOCKS>([]);
  const [showSugg, setShowSugg]     = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [watchlist, setWatchlist]   = useState<WatchlistItem[]>([]);
  const [fetching, setFetching]     = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  /* ── autocomplete ──────────────────────────────────────── */
  useEffect(() => {
    const q = query.trim().toUpperCase();
    if (!q) { setSuggestions([]); return; }
    setSuggestions(
      STOCKS.filter(s => s.ticker.startsWith(q) || s.name.toUpperCase().includes(q)).slice(0, 6)
    );
  }, [query]);

  /* ── fetch watchlist ────────────────────────────────────── */
  const fetchWatchlist = async () => {
    if (!supabase || !user) return;
    const { data } = await supabase
      .from('watchlist')
      .select('*')
      .eq('user_id', user.id)
      .order('last_updated', { ascending: false });
    if (data) setWatchlist(data);
    setFetching(false);
  };

  useEffect(() => {
    if (!user) { setFetching(false); return; }
    if (!supabase) { setFetching(false); return; }
    fetchWatchlist();
    let active = true;
    const channel = supabase
      .channel(`target-watchlist-${user.id}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'watchlist', filter: `user_id=eq.${user.id}` },
        () => { if (active) fetchWatchlist(); })
      .subscribe();
    return () => { active = false; supabase.removeChannel(channel); };
  }, [user?.id]);

  /* ── add ticker ─────────────────────────────────────────── */
  const addTicker = async (ticker: string) => {
    if (!ticker.trim() || !supabase || !user) return;
    const t = ticker.trim().toUpperCase();
    if (watchlist.find(w => w.ticker === t)) { setQuery(''); setShowSugg(false); return; }

    setSubmitting(t);
    setQuery('');
    setShowSugg(false);

    const { data, error } = await supabase
      .from('watchlist')
      .insert([{ ticker: t, user_id: user.id, status: 'scanning' }])
      .select().single();

    if (error) { console.error('Insert error:', error); setSubmitting(null); return; }

    if (data) {
      fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: data.ticker, user_id: user.id, row_id: data.id }),
      }).catch(console.error);
      await fetchWatchlist();
    }
    setSubmitting(null);
  };

  /* ── delete ─────────────────────────────────────────────── */
  const deleteTicker = async (id: string) => {
    if (!supabase) return;
    await supabase.from('watchlist').delete().eq('id', id);
    setWatchlist(prev => prev.filter(w => w.id !== id));
  };

  /* ── re-scan ────────────────────────────────────────────── */
  const reScan = async (item: WatchlistItem) => {
    if (!supabase || !user) return;
    await supabase.from('watchlist').update({ status: 'scanning' }).eq('id', item.id);
    fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: item.ticker, user_id: user.id, row_id: item.id, experimental_mode: item.experimental_mode }),
    }).catch(console.error);
    setWatchlist(prev => prev.map(w => w.id === item.id ? { ...w, status: 'scanning' } : w));
  };

  /* ── guards ─────────────────────────────────────────────── */
  if (loading || fetching) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh', gap: 12, fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '.18em', color: 'var(--muted)', textTransform: 'uppercase' }}>
      <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Checking access
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (isConnected && !user) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '50vh', gap: 16, textAlign: 'center', padding: '0 24px' }}>
      <p style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '.18em', color: 'var(--muted)', textTransform: 'uppercase' }}>Sign in to track targets</p>
    </div>
  );

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: 'clamp(100px,14vw,160px) clamp(20px,8vw,64px) 140px' }}>

      {/* ── Search bar ──────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
        <div style={{ marginBottom: 12, fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--muted)' }}>
          Input Target
        </div>
        <div style={{ position: 'relative' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '18px 24px',
            background: 'rgba(250,250,247,.85)', backdropFilter: 'blur(20px)',
            border: '1px solid rgba(10,10,10,.12)', borderRadius: 16,
            boxShadow: '0 4px 24px rgba(10,10,10,.04)',
          }}>
            <Search size={16} style={{ color: 'var(--muted)', flexShrink: 0 }} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => { setQuery(e.target.value); setShowSugg(true); }}
              onKeyDown={e => {
                if (e.key === 'Enter' && query.trim()) addTicker(query.trim());
                if (e.key === 'Escape') setShowSugg(false);
              }}
              onFocus={() => setShowSugg(true)}
              onBlur={() => setTimeout(() => setShowSugg(false), 150)}
              placeholder="Search ticker or company name…"
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                fontFamily: 'var(--f-mono)', fontSize: 14, fontWeight: 500,
                letterSpacing: '.08em', color: 'var(--ink)',
              }}
            />
            {query.trim() && (
              <button
                onClick={() => addTicker(query.trim())}
                disabled={!!submitting}
                style={{
                  padding: '8px 20px', background: 'var(--accent)', color: 'var(--paper)',
                  border: 'none', borderRadius: 999, cursor: 'pointer',
                  fontFamily: 'var(--f-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase',
                  whiteSpace: 'nowrap', transition: 'opacity .2s',
                  opacity: submitting ? 0.5 : 1,
                }}
              >
                {submitting ? 'Scanning…' : 'Scan →'}
              </button>
            )}
          </div>

          {/* Autocomplete dropdown */}
          <AnimatePresence>
            {showSugg && suggestions.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.15 }}
                style={{
                  position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 100,
                  background: 'rgba(250,250,247,.97)', backdropFilter: 'blur(24px)',
                  border: '1px solid rgba(10,10,10,.1)', borderRadius: 12,
                  boxShadow: '0 12px 40px rgba(10,10,10,.08)', overflow: 'hidden',
                }}
              >
                {suggestions.map(s => (
                  <button
                    key={s.ticker}
                    onMouseDown={() => addTicker(s.ticker)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 16,
                      width: '100%', padding: '12px 20px',
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      textAlign: 'left', transition: 'background .15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(10,10,10,.04)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 12, fontWeight: 600, letterSpacing: '.1em', color: 'var(--ink)', minWidth: 56 }}>{s.ticker}</span>
                    <span style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* ── Watchlist + Analysis ─────────────────────────────── */}
      <div style={{ marginTop: 56 }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          paddingBottom: 12, borderBottom: '1px solid var(--ink)',
          marginBottom: 32,
          fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '.18em',
          textTransform: 'uppercase',
        }}>
          <span style={{ color: 'var(--ink)' }}>Watchlist</span>
          {watchlist.length > 0 && (
            <span style={{ color: 'var(--muted)' }}>{watchlist.length} target{watchlist.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        {watchlist.length === 0 ? (
          <p style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--muted-2)', letterSpacing: '.1em' }}>
            No targets yet. Search a ticker above to begin.
          </p>
        ) : (
          <motion.div
            variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
            initial="hidden" animate="visible"
            style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
          >
            {watchlist.map(item => (
              <AnalysisCard key={item.id} item={item} onDelete={deleteTicker} onRescan={reScan} />
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}

function AnalysisCard({ item, onDelete, onRescan }: { item: WatchlistItem; onDelete: (id: string) => void; onRescan: (item: WatchlistItem) => void }) {
  const [expanded, setExpanded] = useState(false);
  const isScanning = item.status === 'scanning';
  const hasAnalysis = !!item.reasoning;
  const sentimentColor = item.sentiment ? (SENTIMENT_COLOR[item.sentiment] ?? 'var(--muted)') : 'var(--muted)';

  return (
    <motion.div
      variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0, transition: { duration: 0.4, ease: [0.2, 0.7, 0.3, 1] } } }}
      style={{ borderBottom: '1px solid var(--rule)' }}
    >
      {/* Row */}
      <div
        onClick={() => hasAnalysis && setExpanded(e => !e)}
        style={{
          display: 'grid', gridTemplateColumns: '1fr auto auto auto',
          alignItems: 'center', gap: 16,
          padding: '20px 4px',
          cursor: hasAnalysis ? 'pointer' : 'default',
          transition: 'background .2s',
        }}
        onMouseEnter={e => { if (hasAnalysis) (e.currentTarget as HTMLElement).style.paddingLeft = '12px'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.paddingLeft = '4px'; }}
      >
        {/* Ticker + status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 16, fontWeight: 600, letterSpacing: '.12em', color: 'var(--ink)' }}>
            {item.ticker}
          </span>
          {isScanning ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--f-mono)', fontSize: 9, fontWeight: 500, letterSpacing: '.16em', color: 'var(--accent)', textTransform: 'uppercase' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', animation: 'pulse-dot 1.2s ease-in-out infinite' }} />
              Scanning
              <style>{`@keyframes pulse-dot { 0%,100%{opacity:1} 50%{opacity:.3} }`}</style>
            </span>
          ) : item.sentiment ? (
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: sentimentColor }}>
              {item.sentiment}
            </span>
          ) : null}
          {item.reasoning && (
            <span style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: expanded ? 'none' : 'block' }}>
              {item.reasoning.slice(0, 80)}…
            </span>
          )}
        </div>

        {/* Time horizon */}
        {item.time_horizon && (
          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, fontWeight: 500, letterSpacing: '.14em', color: 'var(--muted)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
            {item.time_horizon}
          </span>
        )}

        {/* Re-scan */}
        <button
          onClick={e => { e.stopPropagation(); onRescan(item); }}
          disabled={isScanning}
          style={{ fontFamily: 'var(--f-mono)', fontSize: 9, fontWeight: 500, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--muted)', background: 'none', border: 'none', cursor: isScanning ? 'default' : 'pointer', opacity: isScanning ? 0.4 : 1, padding: '4px 8px', borderRadius: 6, transition: 'color .2s' }}
          onMouseEnter={e => { if (!isScanning) (e.currentTarget as HTMLElement).style.color = 'var(--ink)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; }}
        >
          ↺
        </button>

        {/* Delete */}
        <button
          onClick={e => { e.stopPropagation(); onDelete(item.id); }}
          style={{ color: 'var(--muted-2)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: 6, display: 'flex', alignItems: 'center', transition: 'color .2s' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'oklch(0.52 0.14 28)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--muted-2)'; }}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Expanded analysis */}
      <AnimatePresence>
        {expanded && hasAnalysis && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.2, 0.7, 0.3, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '0 4px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Meta row */}
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                {[
                  { label: 'Sentiment',           value: item.sentiment },
                  { label: 'Political Sentiment',  value: item.political_sentiment },
                  { label: 'Time Horizon',         value: item.time_horizon },
                  { label: 'Data Quality',         value: item.data_quality },
                  { label: 'Scans',                value: item.analysis_count?.toString() },
                ].filter(m => m.value).map(m => (
                  <div key={m.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, fontWeight: 500, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>{m.label}</span>
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, fontWeight: 600, letterSpacing: '.1em', color: 'var(--ink)' }}>{m.value}</span>
                  </div>
                ))}
              </div>

              {/* Reasoning */}
              <div style={{ padding: '20px 24px', background: 'rgba(10,10,10,.03)', border: '1px solid var(--rule)', borderRadius: 10 }}>
                <p style={{ fontFamily: 'var(--f-body)', fontSize: 14, lineHeight: 1.75, color: 'var(--ink-2)', margin: 0 }}>
                  {item.reasoning}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
