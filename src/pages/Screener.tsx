import { useState, useEffect } from 'react';
import { useAuth } from '../lib/useAuth';
import { motion } from 'motion/react';
import { supabase } from '../lib/supabase';
import { ChevronDown } from 'lucide-react';

interface Bar { t: number; c: number; o: number; h: number; l: number; v: number; }
interface Snapshot {
  name: string;
  marketCap?: number;
  pe?: number;
  dayChange?: number;
  dayChangePct?: number;
  currentPrice?: number;
  week52High?: number;
  week52Low?: number;
  volume?: number;
}

const MASSIVE_KEY = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_MASSIVE_API_KEY) || '';

function fmt(n: number, digits = 2) { return n.toLocaleString('en-US', { maximumFractionDigits: digits }); }
function fmtBig(n: number) {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(2)}M`;
  return `$${fmt(n)}`;
}

function SvgChart({ bars }: { bars: Bar[] }) {
  if (bars.length < 2) return null;
  const W = 800, H = 180, PX = 0, PY = 12;
  const prices = bars.map(b => b.c);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const pts = bars.map((b, i) => ({
    x: PX + (i / (bars.length - 1)) * (W - 2 * PX),
    y: PY + (1 - (b.c - min) / range) * (H - 2 * PY),
  }));
  const linePath = pts.map((p, i) => {
    if (i === 0) return `M ${p.x},${p.y}`;
    const prev = pts[i - 1];
    const cx = (prev.x + p.x) / 2;
    return `C ${cx},${prev.y} ${cx},${p.y} ${p.x},${p.y}`;
  }).join(' ');
  const areaPath = `${linePath} L ${pts[pts.length - 1].x},${H} L ${pts[0].x},${H} Z`;
  const isUp = prices[prices.length - 1] >= prices[0];
  const col = isUp ? 'oklch(0.52 0.14 145)' : 'oklch(0.52 0.16 25)';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={col} stopOpacity="0.18" />
          <stop offset="100%" stopColor={col} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#chartGrad)" />
      <path d={linePath} fill="none" stroke={col} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Last price dot */}
      <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="3.5" fill={col} />
    </svg>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, fontWeight: 500, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--muted)' }}>
        {label}
      </span>
      <span style={{ fontFamily: 'var(--f-mono)', fontSize: 15, fontWeight: 600, letterSpacing: '.04em', color: 'var(--ink)' }}>
        {value}
      </span>
    </div>
  );
}

export function Screener() {
  const { user, loading } = useAuth();
  const [watchlist, setWatchlist] = useState<{ id: string; ticker: string }[]>([]);
  const [ticker, setTicker] = useState<string>('');
  const [dropOpen, setDropOpen] = useState(false);
  const [bars, setBars] = useState<Bar[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!supabase || !user) return;
    supabase.from('watchlist').select('id, ticker').eq('user_id', user.id).order('last_updated', { ascending: false })
      .then(({ data }) => { if (data) setWatchlist(data); });
  }, [user]);

  useEffect(() => {
    if (!ticker) return;
    loadData(ticker);
  }, [ticker]);

  const loadData = async (sym: string) => {
    if (!MASSIVE_KEY) { setError('Add VITE_MASSIVE_API_KEY to .env to load chart data.'); return; }
    setFetching(true);
    setError('');
    try {
      const to = new Date();
      const from = new Date(to);
      from.setDate(from.getDate() - 90);
      const fmt = (d: Date) => d.toISOString().slice(0, 10);

      const [aggRes, snapRes, detailRes] = await Promise.all([
        fetch(`https://api.massive.com/v2/aggs/ticker/${sym}/range/1/day/${fmt(from)}/${fmt(to)}?adjusted=true&sort=asc&limit=90&apiKey=${MASSIVE_KEY}`),
        fetch(`https://api.massive.com/v2/snapshot/locale/us/markets/stocks/tickers/${sym}?apiKey=${MASSIVE_KEY}`),
        fetch(`https://api.massive.com/v3/reference/tickers/${sym}?apiKey=${MASSIVE_KEY}`),
      ]);

      const [aggData, snapData, detailData] = await Promise.all([aggRes.json(), snapRes.json(), detailRes.json()]);

      if (aggData.results) setBars(aggData.results);

      const snap = snapData.ticker;
      const detail = detailData.results;
      if (snap || detail) {
        setSnapshot({
          name: detail?.name ?? sym,
          marketCap: detail?.market_cap ?? snap?.day?.v * snap?.day?.c,
          pe: undefined,
          currentPrice: snap?.day?.c,
          dayChange: snap?.todaysChange,
          dayChangePct: snap?.todaysChangePerc,
          week52High: snap?.prevDay?.h,
          week52Low: snap?.prevDay?.l,
          volume: snap?.day?.v,
        });
      }
    } catch (e) {
      setError('Failed to load data. Check your API key.');
    }
    setFetching(false);
  };

  const isUp = bars.length >= 2 ? bars[bars.length - 1].c >= bars[0].c : true;
  const changeColor = (snapshot?.dayChangePct ?? 0) >= 0 ? 'oklch(0.52 0.14 145)' : 'oklch(0.52 0.16 25)';

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh' }}>
      <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '.2em', color: 'var(--muted)', textTransform: 'uppercase' }}>Loading...</span>
    </div>
  );

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
          SCREENER
        </span>

        {/* Ticker picker */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setDropOpen(!dropOpen)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 10,
              padding: '9px 16px', borderRadius: 999,
              background: 'var(--paper)', border: '1px solid var(--rule)',
              fontFamily: 'var(--f-mono)', fontSize: 11, fontWeight: 600, letterSpacing: '.1em',
              color: ticker ? 'var(--ink)' : 'var(--muted)', cursor: 'pointer',
              transition: 'border-color .15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--ink)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--rule)')}
          >
            {ticker || 'Select from watchlist'}
            <ChevronDown size={12} style={{ color: 'var(--muted)', transform: dropOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
          </button>
          {dropOpen && watchlist.length > 0 && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 100,
              background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 12,
              boxShadow: '0 16px 40px rgba(10,10,10,.08)', minWidth: 160, overflow: 'hidden',
            }}>
              {watchlist.map(w => (
                <button
                  key={w.id}
                  onClick={() => { setTicker(w.ticker); setDropOpen(false); }}
                  style={{
                    display: 'block', width: '100%', padding: '11px 16px',
                    border: 'none', background: ticker === w.ticker ? 'var(--paper-2)' : 'transparent',
                    fontFamily: 'var(--f-mono)', fontSize: 11, fontWeight: 600, letterSpacing: '.1em',
                    color: 'var(--ink)', cursor: 'pointer', textAlign: 'left', transition: 'background .12s',
                  }}
                  onMouseEnter={e => { if (ticker !== w.ticker) (e.currentTarget.style.background = 'var(--paper-2)'); }}
                  onMouseLeave={e => { if (ticker !== w.ticker) (e.currentTarget.style.background = 'transparent'); }}
                >
                  {w.ticker}
                </button>
              ))}
            </div>
          )}
          {dropOpen && watchlist.length === 0 && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 100,
              background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 12,
              padding: '14px 16px', minWidth: 200,
            }}>
              <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '.12em' }}>
                Add signals first
              </span>
            </div>
          )}
        </div>
      </div>

      {!ticker ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '.18em', color: 'var(--muted-2)', textTransform: 'uppercase' }}>
            Select a ticker to begin
          </span>
        </div>
      ) : fetching ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {[1, 0.8, 0.6].map((w, i) => (
            <div key={i} style={{ height: 20, background: 'var(--paper-2)', borderRadius: 6, width: `${w * 100}%`, animation: 'pulse 1.8s ease-in-out infinite', animationDelay: `${i * 0.1}s` }} />
          ))}
          <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
        </div>
      ) : error ? (
        <div style={{
          padding: '32px 36px', border: '1px dashed var(--rule)', borderRadius: 14, textAlign: 'center',
        }}>
          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '.12em' }}>
            {error}
          </span>
          <p style={{ fontFamily: 'var(--f-body)', fontSize: 12, color: 'var(--muted-2)', marginTop: 8 }}>
            Add <code style={{ background: 'var(--paper-2)', padding: '2px 6px', borderRadius: 4 }}>VITE_MASSIVE_API_KEY</code> to your .env file. Key name: <strong>quizzical_yalow</strong>.
          </p>
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          style={{ display: 'flex', flexDirection: 'column', gap: 32 }}
        >
          {/* Price header + chart — double-bezel */}
          <div style={{
            padding: 3, borderRadius: 20,
            background: 'var(--accent-soft)',
            border: '1px solid var(--accent)',
            opacity: undefined,
          }}>
            <div style={{
              background: 'var(--paper)', border: '1px solid var(--rule)',
              borderRadius: 17, padding: '24px 24px 16px',
              display: 'flex', flexDirection: 'column', gap: 20,
            }}>
              {/* Price header */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--f-display)', fontSize: 64, fontWeight: 400, lineHeight: 1, letterSpacing: '-.02em', color: 'var(--ink)' }}>
                  {snapshot?.name ?? ticker}
                </span>
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 16, fontWeight: 600, letterSpacing: '.04em', color: 'var(--ink)' }}>
                  {snapshot?.currentPrice ? `$${fmt(snapshot.currentPrice)}` : ticker}
                </span>
                {snapshot?.dayChangePct !== undefined && (
                  <span style={{ fontFamily: 'var(--f-mono)', fontSize: 13, letterSpacing: '.08em', color: changeColor }}>
                    {snapshot.dayChangePct >= 0 ? '+' : ''}{fmt(snapshot.dayChangePct)}%
                  </span>
                )}
              </div>

              {/* Chart */}
              <div style={{ background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 12, padding: '20px 20px 12px', overflow: 'hidden' }}>
                {bars.length > 1 ? (
                  <>
                    <SvgChart bars={bars} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                      <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '.12em', color: 'var(--muted-2)' }}>
                        {new Date(bars[0].t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                      <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '.12em', color: 'var(--muted-2)' }}>
                        {new Date(bars[bars.length - 1].t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  </>
                ) : (
                  <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '.14em' }}>No chart data</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Metrics grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 1, background: 'var(--rule)', border: '1px solid var(--rule)', borderRadius: 10, overflow: 'hidden' }}>
            {[
              { label: 'Market Cap',  value: snapshot?.marketCap ? fmtBig(snapshot.marketCap) : 'N/A' },
              { label: 'Volume',      value: snapshot?.volume ? fmt(snapshot.volume, 0) : 'N/A' },
              { label: '52W High',    value: snapshot?.week52High ? `$${fmt(snapshot.week52High)}` : 'N/A' },
              { label: '52W Low',     value: snapshot?.week52Low  ? `$${fmt(snapshot.week52Low)}`  : 'N/A' },
              { label: 'Day Change',  value: snapshot?.dayChange  ? `${snapshot.dayChange >= 0 ? '+' : ''}$${fmt(Math.abs(snapshot.dayChange))}` : 'N/A' },
              { label: 'Bars (90d)',  value: bars.length.toString() },
            ].map(m => (
              <div key={m.label} style={{ background: 'var(--paper)', padding: '20px 24px' }}>
                <Metric label={m.label} value={m.value} />
              </div>
            ))}
          </div>

          {/* Attribution */}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '.14em', color: 'var(--muted-2)', textTransform: 'uppercase' }}>
              Data: Massive.com
            </span>
          </div>
        </motion.div>
      )}
    </div>
  );
}
