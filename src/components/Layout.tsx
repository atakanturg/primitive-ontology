import { Navigation } from './Navigation';
import { ScrollToTop } from './ScrollToTop';
import { Outlet, useLocation } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useScroll, useSpring } from 'motion/react';
import { ArrowDown } from 'lucide-react';

export default function Layout() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const location  = useLocation();
  const [isAtBottom, setIsAtBottom] = useState(false);
  const [isScrollable, setIsScrollable] = useState(false);
  const [isLoading, setIsLoading] = useState(() =>
    typeof window !== 'undefined' ? !sessionStorage.getItem('hasLoaded') : true
  );

  useEffect(() => {
    if (!isLoading) return;
    const t = setTimeout(() => {
      setIsLoading(false);
      sessionStorage.setItem('hasLoaded', 'true');
    }, 1800);
    return () => clearTimeout(t);
  }, [isLoading]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 50);
    el.addEventListener('scroll', onScroll);
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => setIsScrollable(el.scrollHeight > el.clientHeight + 50);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [location.pathname]);

  const scrollToPosition = () => {
    if (!scrollRef.current) return;
    if (isAtBottom) scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    else scrollRef.current.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
  };

  const isHome = location.pathname === '/';

  const { scrollYProgress } = useScroll({ container: scrollRef });
  const scaleX = useSpring(scrollYProgress, { stiffness: 200, damping: 30 });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden', position: 'relative' }}>

      {/* ── Scroll progress ────────────────────────────── */}
      <motion.div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 2, background: 'var(--accent)', scaleX, transformOrigin: '0%', zIndex: 300 }} />

      {/* ── Loading screen ─────────────────────────────── */}
      <AnimatePresence>
        {isLoading && (
          <motion.div
            initial={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.7, ease: 'easeInOut' }}
            style={{
              position: 'fixed', inset: 0, zIndex: 200, background: 'var(--paper)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20,
            }}
          >
            <div style={{
              width: 48, height: 48, background: 'var(--accent)',
              WebkitMask: "url('/logo.png') center / contain no-repeat",
              mask: "url('/logo.png') center / contain no-repeat",
            }} />
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--muted)' }}>
              Primitive Ontology
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <ScrollToTop />

      {/* ── Ambient background ─────────────────────────── */}
      <div className="ambient" aria-hidden="true">
        <div className="smoke s1" />
        <div className="smoke s2" />
        <div className="smoke s3" />
      </div>


      {/* ── Topmark (scrolls away) ──────────────────────── */}
      <a href="https://primitive-os.cc" className="topmark" aria-label="Primitive OS">
        <span style={{
          display: 'block', width: 'var(--topmark-logo)', height: 'var(--topmark-logo)',
          background: 'var(--accent)',
          WebkitMask: "url('/logo.png') center / contain no-repeat",
          mask: "url('/logo.png') center / contain no-repeat",
          flexShrink: 0,
        }} />
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span style={{ fontFamily: 'var(--f-mono)', fontSize: '10.5px', fontWeight: 500, letterSpacing: '.24em', textTransform: 'uppercase', color: 'var(--muted)' }}>
            PRIMITIVE
          </span>
          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 'var(--topmark-text)', fontWeight: 500, letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--accent)', marginTop: 4 }}>
            ONTOLOGY
          </span>
        </span>
      </a>

      {/* ── Scroll container ───────────────────────────── */}
      <div
        id="main-scroll-container"
        ref={scrollRef}
        style={{ flexGrow: 1, overflowY: 'auto', overflowX: 'hidden', position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column' }}
      >
        <main style={{ flexGrow: 1, position: 'relative', zIndex: 10 }}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
              style={{ minHeight: '100%' }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>

        {/* ── Footer ───────────────────────────────────── */}
        <footer style={{
          borderTop: '1px solid var(--ink)', padding: '64px 96px 140px',
          background: 'var(--paper)', position: 'relative', zIndex: 1,
        }}>
          <div className="footer-grid">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="mark" style={{ width: 26, height: 26, color: 'var(--accent)' }}><span className="glyph" /></span>
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '.22em' }}>PRIMITIVE · ONTOLOGY</span>
              </div>
              <p style={{ fontFamily: 'var(--f-body)', fontSize: 13, lineHeight: 1.55, color: 'var(--muted)', maxWidth: 280 }}>
                Alternative data intelligence. Congressional trades, FDA filings, port manifests. Synthesized in real time.
              </p>
            </div>
            <div>
              <p style={{ fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 16 }}>Navigation</p>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[['/', 'Overview'], ['/target', 'Input Target'], ['/data', 'See Data']].map(([href, label]) => (
                  <li key={href}><a href={href} style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--ink-2)' }}>{label}</a></li>
                ))}
              </ul>
            </div>
            <div>
              <p style={{ fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 16 }}>Legal</p>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[['https://github.com/atakanturg/primitive-ontology#readme', 'README'], ['https://github.com/atakanturg/primitive-ontology', 'GitHub'], ['https://primitive-os.cc', 'Primitive OS']].map(([href, label]) => (
                  <li key={label}><a href={href} style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--ink-2)' }}>{label}</a></li>
                ))}
              </ul>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 48, paddingTop: 24, borderTop: '1px solid var(--rule)', fontFamily: 'var(--f-mono)', fontSize: '9.5px', letterSpacing: '.18em', color: 'var(--muted)' }}>
            <span>© 2026 · Primitive Ontology</span>
            <span>Atakan Turgut · Miami</span>
          </div>
        </footer>
      </div>

      {/* ── Nav pill (fixed bottom) ────────────────────── */}
      <div style={{ flexShrink: 0, position: 'relative', zIndex: 50 }}>
        <Navigation />
      </div>

      {/* ── Scroll arrow ───────────────────────────────── */}
      {isScrollable && isHome && (
        <motion.button
          onClick={scrollToPosition}
          style={{
            position: 'fixed', bottom: 100, right: 32, zIndex: 50,
            width: 44, height: 44,
            background: 'rgba(250,250,247,.85)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(10,10,10,.1)',
            borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'var(--muted)',
            boxShadow: '0 8px 24px rgba(10,10,10,.06)',
          }}
          animate={{ y: [0, 8, 0] }}
          transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
        >
          <motion.div animate={{ rotate: isAtBottom ? 180 : 0 }} transition={{ duration: 0.4 }}>
            <ArrowDown size={16} strokeWidth={1.5} />
          </motion.div>
        </motion.button>
      )}
    </div>
  );
}
