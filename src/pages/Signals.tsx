import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../lib/useAuth';
import { motion, AnimatePresence } from 'motion/react';
import { Trash2, HelpCircle, Search, RefreshCw, ArrowUpRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { searchStocks } from '../lib/stocks';
import { Link } from 'react-router-dom';
import { TiltCard } from '../components/TiltCard';

interface WatchlistItem {
  id: string;
  ticker: string;
  status: string;
  sentiment?: string;
  reasoning?: string;
  last_analyzed_at?: string;
  analysis_count?: number;
  experimental_mode?: boolean;
}

const BACKEND_URL = '/api/analyze';

function TickerSearch({ onAdd, existing }: { onAdd: (ticker: string) => void; existing: string[] }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ ticker: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const found = searchStocks(query);
    setResults(found.filter(r => !existing.includes(r.ticker)));
    setOpen(found.length > 0 && query.length > 0);
  }, [query, existing]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const handleSelect = (ticker: string) => {
    onAdd(ticker);
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: 320 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        background: 'var(--paper)', border: '1px solid var(--rule)',
        borderRadius: 999, padding: '9px 16px',
        transition: 'border-color .2s',
      }}
        onFocusCapture={e => (e.currentTarget.style.borderColor = 'var(--ink)')}
        onBlurCapture={e => (e.currentTarget.style.borderColor = 'var(--rule)')}
      >
        <Search size={13} style={{ color: 'var(--muted)', flexShrink: 0 }} />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search ticker or company"
          style={{
            border: 'none', outline: 'none', background: 'transparent', width: '100%',
            fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '.06em', color: 'var(--ink)',
          }}
        />
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            style={{
              position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 200,
              background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 12,
              boxShadow: '0 16px 40px rgba(10,10,10,.1)', overflow: 'hidden',
            }}
          >
            {results.map(r => (
              <button
                key={r.ticker}
                onMouseDown={() => handleSelect(r.ticker)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', padding: '11px 16px', border: 'none', background: 'transparent',
                  cursor: 'pointer', textAlign: 'left', transition: 'background .12s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--paper-2)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, fontWeight: 600, letterSpacing: '.1em', color: 'var(--ink)' }}>
                  {r.ticker}
                </span>
                <span style={{ fontFamily: 'var(--f-body)', fontSize: 12, color: 'var(--muted)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.name}
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = status === 'scanning' ? 'oklch(0.55 0.15 240)' : status === 'idle' ? 'var(--muted-2)' : 'oklch(0.55 0.13 145)';
  return (
    <span style={{ position: 'relative', display: 'inline-flex', width: 8, height: 8, flexShrink: 0 }}>
      {status === 'scanning' && (
        <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: color, opacity: 0.5, animation: 'ping 1.4s cubic-bezier(0,0,.2,1) infinite' }} />
      )}
      <span style={{ width: '100%', height: '100%', borderRadius: '50%', background: color, display: 'block' }} />
      <style>{`@keyframes ping{75%,100%{transform:scale(2);opacity:0}}`}</style>
    </span>
  );
}

function SentimentBadge({ sentiment }: { sentiment?: string }) {
  if (!sentiment) return null;
  const map: Record<string, { bg: string; color: string }> = {
    Bullish:  { bg: 'oklch(0.96 0.04 145)', color: 'oklch(0.45 0.15 145)' },
    Bearish:  { bg: 'oklch(0.96 0.04 25)',  color: 'oklch(0.45 0.18 25)' },
    Neutral:  { bg: 'var(--paper-2)',        color: 'var(--muted)' },
  };
  const style = map[sentiment] || map.Neutral;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', borderRadius: 999,
      background: style.bg, color: style.color,
      fontFamily: 'var(--f-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase',
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />
      {sentiment}
    </span>
  );
}

export function Signals() {
  const { user, loading, isConnected } = useAuth();
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [fetching, setFetching] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fetchWatchlist = async () => {
    if (!supabase || !user) { setFetching(false); return; }
    const { data, error } = await supabase
      .from('watchlist').select('*').eq('user_id', user.id).order('last_updated', { ascending: false });
    if (!error && data) setWatchlist(data as WatchlistItem[]);
    setFetching(false);
  };

  useEffect(() => {
    if (!user) { setFetching(false); return; }
    fetchWatchlist();
    if (!supabase) return;
    const ch = supabase.channel('signals-watchlist')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'watchlist', filter: `user_id=eq.${user.id}` }, fetchWatchlist)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  const handleAdd = async (ticker: string) => {
    if (!supabase || !user) return;
    const { data, error } = await supabase.from('watchlist')
      .insert([{ ticker: ticker.toUpperCase(), user_id: user.id, status: 'idle' }])
      .select().single();
    if (error || !data) return;
    try {
      fetch(BACKEND_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: data.ticker, user_id: user.id, row_id: data.id }),
      });
    } catch {}
    setSelectedId(data.id);
    fetchWatchlist();
  };

  const handleDelete = async (id: string) => {
    if (!supabase) return;
    await supabase.from('watchlist').delete().eq('id', id);
    if (selectedId === id) setSelectedId(null);
    fetchWatchlist();
  };

  const handleUpdate = async (ticker: string, id: string, experimental_mode: boolean) => {
    if (!supabase) return;
    await supabase.from('watchlist').update({ status: 'scanning' }).eq('id', id);
    try {
      fetch(BACKEND_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, user_id: user?.id, row_id: id, experimental_mode }),
      });
    } catch {}
  };

  const toggleExp = async (e: React.MouseEvent, id: string, current: boolean) => {
    e.stopPropagation();
    if (!supabase) return;
    const val = !current;
    setWatchlist(prev => prev.map(item => item.id === id ? { ...item, experimental_mode: val } : item));
    await supabase.from('watchlist').update({ experimental_mode: val }).eq('id', id);
  };

  const selected = watchlist.find(w => w.id === selectedId) ?? null;

  if (loading || fetching) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh' }}>
        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '.2em', color: 'var(--muted)', textTransform: 'uppercase' }}>
          Loading...
        </span>
      </div>
    );
  }

  if (isConnected && !user) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '50vh', gap: 16 }}>
        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '.18em', color: 'var(--muted)', textTransform: 'uppercase' }}>
          Sign in to access signals
        </span>
      </div>
    );
  }

  return (
    <div style={{ padding: '120px 96px 160px', maxWidth: 1280, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 48, paddingBottom: 14, borderBottom: '1px solid var(--accent)',
      }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '5px 12px',
          background: 'var(--accent-soft)',
          borderRadius: 999,
          fontFamily: 'var(--f-mono)', fontSize: 9, fontWeight: 600,
          letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--accent)',
          border: '1px solid var(--accent)',
        }}>
          SIGNALS · {watchlist.length}
        </span>
        <TickerSearch onAdd={handleAdd} existing={watchlist.map(w => w.ticker)} />
      </div>

      {watchlist.length === 0 ? (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 12, padding: '80px 0', textAlign: 'center',
        }}>
          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '.18em', color: 'var(--muted)', textTransform: 'uppercase' }}>
            No signals tracked
          </span>
          <span style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--muted-2)' }}>
            Search for a ticker above to begin.
          </span>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 40, alignItems: 'start' }}>
          {/* Watchlist */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {watchlist.map(item => {
              const active = selectedId === item.id;
              return (
                <div key={item.id} style={{ display: 'flex', flexDirection: 'column' }}>
                  <div
                    onClick={() => setSelectedId(active ? null : item.id)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '14px 16px', borderRadius: 10, cursor: 'pointer',
                      background: active ? 'var(--paper-2)' : 'transparent',
                      border: `1px solid ${active ? 'var(--ink)' : 'transparent'}`,
                      transition: 'background .15s, border-color .15s',
                    }}
                    onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--paper-2)'; }}
                    onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <StatusDot status={item.status} />
                      <span style={{ fontFamily: 'var(--f-mono)', fontSize: 12, fontWeight: 600, letterSpacing: '.12em', color: 'var(--ink)' }}>
                        {item.ticker}
                      </span>
                      {item.sentiment && <SentimentBadge sentiment={item.sentiment} />}
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(item.id); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted-2)', padding: 4, borderRadius: 6, transition: 'color .15s' }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'oklch(0.5 0.18 25)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted-2)')}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>

                  {/* Experimental toggle (shown when selected) */}
                  <AnimatePresence>
                    {active && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        style={{ overflow: 'hidden' }}
                      >
                        <div style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          margin: '2px 0', padding: '10px 16px',
                          background: 'oklch(0.98 0.02 70)', border: '1px solid oklch(0.88 0.06 70)',
                          borderRadius: 8,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '.16em', color: 'oklch(0.5 0.1 70)', textTransform: 'uppercase' }}>
                              Experimental
                            </span>
                            <div style={{ position: 'relative' }} className="group">
                              <HelpCircle size={11} style={{ color: 'oklch(0.6 0.08 70)', cursor: 'help' }} />
                            </div>
                          </div>
                          <button
                            onClick={e => toggleExp(e, item.id, item.experimental_mode ?? false)}
                            style={{
                              position: 'relative', width: 34, height: 18, borderRadius: 999,
                              border: 'none', cursor: 'pointer',
                              background: item.experimental_mode ? 'oklch(0.6 0.1 70)' : 'var(--rule)',
                              transition: 'background .2s',
                            }}
                          >
                            <span style={{
                              position: 'absolute', top: 2, width: 14, height: 14, borderRadius: '50%',
                              background: 'white', transition: 'left .2s',
                              left: item.experimental_mode ? 18 : 2,
                            }} />
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>

          {/* Analysis panel */}
          <AnimatePresence mode="wait">
            {selected ? (
              <TiltCard
                key={selected.id}
                style={{
                  padding: 3, borderRadius: 18,
                  background: 'var(--paper-2)',
                  border: '1px solid var(--rule)',
                  boxShadow: '0 2px 8px rgba(10,10,10,.04)',
                }}
              >
              <div style={{
                background: 'var(--paper)', border: '1px solid var(--rule)',
                borderRadius: 14, padding: '32px 36px',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,.8)',
              }}>
                {/* Card header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 20, fontWeight: 700, letterSpacing: '.1em', color: 'var(--ink)' }}>
                      {selected.ticker}
                    </span>
                    <StatusDot status={selected.status} />
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '.16em', color: 'var(--muted)', textTransform: 'uppercase' }}>
                      {selected.status}
                    </span>
                    {selected.sentiment && <SentimentBadge sentiment={selected.sentiment} />}
                    {selected.experimental_mode && (
                      <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '.14em', color: 'oklch(0.55 0.1 70)', background: 'oklch(0.96 0.02 70)', padding: '4px 8px', borderRadius: 999, textTransform: 'uppercase' }}>
                        Experimental
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {selected.last_analyzed_at && (
                      <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '.12em', color: 'var(--muted-2)', textTransform: 'uppercase' }}>
                        {new Date(selected.last_analyzed_at).toLocaleString()}
                      </span>
                    )}
                    <button
                      onClick={() => handleUpdate(selected.ticker, selected.id, selected.experimental_mode ?? false)}
                      disabled={selected.status === 'scanning'}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '7px 14px', borderRadius: 999,
                        background: 'var(--paper-2)', border: '1px solid var(--rule)',
                        fontFamily: 'var(--f-mono)', fontSize: 9, fontWeight: 500, letterSpacing: '.14em', textTransform: 'uppercase',
                        color: 'var(--ink)', cursor: 'pointer', transition: 'background .15s',
                        opacity: selected.status === 'scanning' ? 0.4 : 1,
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--paper-3, #e8e5dd)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'var(--paper-2)')}
                    >
                      <RefreshCw size={10} />
                      {selected.status === 'scanning' ? 'Scanning' : 'Refresh'}
                    </button>
                    <Link
                      to="/screener"
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '7px 14px', borderRadius: 999,
                        background: 'var(--accent)', border: '1px solid var(--accent)',
                        fontFamily: 'var(--f-mono)', fontSize: 9, fontWeight: 500, letterSpacing: '.14em', textTransform: 'uppercase',
                        color: 'var(--paper)', textDecoration: 'none', transition: 'opacity .15s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
                      onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                    >
                      Screener <ArrowUpRight size={10} />
                    </Link>
                  </div>
                </div>

                {/* Reasoning */}
                <div style={{ paddingTop: 20, borderTop: '1px solid var(--rule)' }}>
                  {selected.status === 'scanning' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {[100, 88, 72, 60].map((w, i) => (
                        <div key={i} style={{ height: 14, background: 'var(--paper-2)', borderRadius: 4, width: `${w}%`, animation: 'pulse 1.8s ease-in-out infinite', animationDelay: `${i * 0.1}s` }} />
                      ))}
                      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
                    </div>
                  ) : selected.reasoning ? (
                    <p style={{ fontFamily: 'var(--f-display)', fontStyle: 'italic', fontSize: 17, lineHeight: 1.7, color: 'var(--ink-2)', margin: 0 }}>
                      {selected.reasoning}
                    </p>
                  ) : (
                    <span style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--muted)' }}>
                      Analysis pending.
                    </span>
                  )}
                </div>

                {selected.analysis_count !== undefined && selected.analysis_count > 0 && (
                  <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '.16em', color: 'var(--muted-2)', textTransform: 'uppercase' }}>
                      {selected.analysis_count} scan{selected.analysis_count !== 1 ? 's' : ''}
                    </span>
                  </div>
                )}
              </div>
              </TiltCard>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  minHeight: 220, border: '1px dashed var(--rule)', borderRadius: 14,
                  padding: 40,
                }}
              >
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '.18em', color: 'var(--muted-2)', textTransform: 'uppercase' }}>
                  Select a signal to view analysis
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <style>{`
        @media (max-width: 900px) {
          [data-signals-layout] { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
