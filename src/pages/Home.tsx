import { useRef } from 'react';
import { motion, useMotionValue, useSpring, animate } from 'motion/react';
import { Link } from 'react-router-dom';
import { AmbientMesh } from '../components/AmbientMesh';

const DATA_SOURCES = [
  { tag: 'POLITICAL',  title: 'Congressional Disclosures',   description: 'Senate and House equity filings. 535 legislators.' },
  { tag: 'BIOTECH',    title: 'FDA Signal Tracking',          description: 'PDUFA dates, AdCom votes, NDA submissions, clinical updates.' },
  { tag: 'MACRO',      title: 'Port Manifest Intelligence',   description: 'Cargo manifests, customs filings, trade anomalies.' },
  { tag: 'REGULATORY', title: 'SEC Filings',                  description: 'Institutional positions, insider transactions, 8-K events.' },
];

const TAPE = [
  { sym: 'AAPL',  dir: '+' }, { sym: 'NVDA',  dir: '+' }, { sym: 'TSLA',  dir: '○' },
  { sym: 'META',  dir: '+' }, { sym: 'PLTR',  dir: '+' }, { sym: 'AMZN',  dir: '○' },
  { sym: 'GOOGL', dir: '+' }, { sym: 'MSFT',  dir: '+' }, { sym: 'AMD',   dir: '-' },
  { sym: 'COIN',  dir: '○' }, { sym: 'REGN',  dir: '+' }, { sym: 'LLY',   dir: '+' },
  { sym: 'BIDU',  dir: '-' }, { sym: 'BA',    dir: '-' }, { sym: 'NVO',   dir: '+' },
  { sym: 'CRWD',  dir: '+' }, { sym: 'SNOW',  dir: '○' }, { sym: 'SHOP',  dir: '+' },
];

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.09 } },
};

const fadeUp = {
  hidden:   { opacity: 0, y: 20 },
  visible:  { opacity: 1, y: 0, transition: { duration: 0.65, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] } },
};

function MagneticLink({ to, children, accent }: { to: string; children: React.ReactNode; accent?: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 300, damping: 22 });
  const sy = useSpring(y, { stiffness: 300, damping: 22 });

  const onMove = (e: React.MouseEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    x.set((e.clientX - (rect.left + rect.width / 2)) * 0.25);
    y.set((e.clientY - (rect.top + rect.height / 2)) * 0.25);
  };
  const onLeave = () => {
    animate(x, 0, { type: 'spring', stiffness: 300, damping: 25 });
    animate(y, 0, { type: 'spring', stiffness: 300, damping: 25 });
  };

  return (
    <motion.a
      ref={ref as any}
      href={to}
      onClick={e => { e.preventDefault(); window.history.pushState({}, '', to); window.dispatchEvent(new PopStateEvent('popstate')); }}
      style={{
        x: sx, y: sy,
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '13px 28px', borderRadius: 999, textDecoration: 'none',
        fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 500,
        letterSpacing: '.16em', textTransform: 'uppercase' as const,
        ...(accent
          ? { background: 'var(--accent)', color: 'var(--paper)' }
          : { background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)' }),
        cursor: 'pointer',
      }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      whileTap={{ scale: 0.97 }}
    >
      {children}
    </motion.a>
  );
}

export function Home() {
  return (
    <div className="w-full">
      {/* HERO */}
      <section className="px-6 md:px-24 pt-40 pb-16 max-w-5xl mx-auto" style={{ position: 'relative' }}>
        <AmbientMesh color="oklch(0.45 0.06 240)" />
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
          className="flex flex-col items-start space-y-8"
        >
          <h1 style={{ fontFamily: 'var(--f-display)', fontWeight: 400, fontSize: 'clamp(48px, 8vw, 88px)', lineHeight: 1.04, letterSpacing: '-.025em', color: 'var(--ink)', margin: 0 }}>
            Primitive <span className="hand">Ontology</span>
          </h1>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Link
              to="/signals"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '13px 26px', borderRadius: 999,
                background: 'var(--accent)', color: 'var(--paper)',
                fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 500,
                letterSpacing: '.16em', textTransform: 'uppercase', textDecoration: 'none',
                transition: 'opacity .2s',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '.82')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
            >
              View signals
            </Link>
            <Link
              to="/screener"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '13px 26px', borderRadius: 999,
                background: 'transparent', color: 'var(--accent)',
                border: '1px solid var(--accent)',
                fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 500,
                letterSpacing: '.16em', textTransform: 'uppercase', textDecoration: 'none',
                transition: 'border-color .2s, background .2s',
              }}
              onMouseEnter={e => { (e.currentTarget.style.borderColor = 'var(--accent)'); (e.currentTarget.style.background = 'var(--accent-soft)'); }}
              onMouseLeave={e => { (e.currentTarget.style.borderColor = 'var(--accent)'); (e.currentTarget.style.background = 'transparent'); }}
            >
              Screener
            </Link>
          </div>
        </motion.div>
      </section>

      {/* TICKER TAPE */}
      <div style={{
        overflow: 'hidden',
        borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)',
        padding: '12px 0',
        userSelect: 'none', cursor: 'default',
      }}>
        <div style={{
          display: 'inline-flex', gap: 52, whiteSpace: 'nowrap',
          animation: 'ticker-scroll 38s linear infinite',
        }}>
          {[...TAPE, ...TAPE].map((t, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
              <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, fontWeight: 600, letterSpacing: '.12em', color: 'var(--ink)' }}>
                {t.sym}
              </span>
              <span style={{
                fontFamily: 'var(--f-mono)', fontSize: 11, lineHeight: 1,
                color: t.dir === '+' ? 'oklch(0.52 0.14 145)' : t.dir === '-' ? 'oklch(0.52 0.16 25)' : 'var(--muted-2)',
              }}>
                {t.dir}
              </span>
            </span>
          ))}
        </div>
        <style>{`
          @keyframes ticker-scroll {
            from { transform: translateX(0); }
            to   { transform: translateX(-50%); }
          }
          @media (prefers-reduced-motion: reduce) {
            [style*="ticker-scroll"] { animation: none !important; }
          }
        `}</style>
      </div>

      {/* DATA SOURCES */}
      <section style={{ padding: '48px 96px 96px', maxWidth: 1280, margin: '0 auto' }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          marginBottom: 28, paddingBottom: 12, borderBottom: '1px solid var(--accent)',
        }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '5px 12px', background: 'var(--accent-soft)', borderRadius: 999,
            fontFamily: 'var(--f-mono)', fontSize: 9, fontWeight: 600,
            letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--accent)',
            border: '1px solid var(--accent)',
          }}>
            SOURCES · 04
          </span>
        </div>
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.1 }}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1, background: 'var(--rule)', border: '1px solid var(--rule)', overflow: 'hidden' }}
        >
          {DATA_SOURCES.map((src, i) => (
            <motion.div
              key={i}
              variants={fadeUp}
              style={{
                background: 'var(--paper)', padding: '36px 40px',
                display: 'flex', flexDirection: 'column', gap: 14,
                transition: 'background .25s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--paper-2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'var(--paper)')}
            >
              <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, fontWeight: 500, letterSpacing: '.28em', textTransform: 'uppercase', color: 'var(--accent)' }}>
                {src.tag}
              </span>
              <h3 style={{ fontFamily: 'var(--f-display)', fontWeight: 400, fontSize: 22, letterSpacing: '-.005em', color: 'var(--ink)', margin: 0 }}>
                {src.title}
              </h3>
              <p style={{ fontFamily: 'var(--f-body)', fontSize: 13, lineHeight: 1.55, color: 'var(--muted)', margin: 0 }}>
                {src.description}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      <style>{`
        @media (max-width: 900px) {
          section:first-child { padding: 120px 24px 80px !important; }
          section:last-child { padding: 0 24px 80px !important; }
        }
      `}</style>
    </div>
  );
}
