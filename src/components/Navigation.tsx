import { AnimatePresence, motion } from 'motion/react';
import { Menu, X, LogIn, LogOut, Mail } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';
import { supabase } from '../lib/supabase';

const ROUTES = [
  { path: '/',         label: 'Overview' },
  { path: '/signals',  label: 'Signals'  },
  { path: '/screener', label: 'Screener' },
];

const ACCENT = 'var(--accent)';

export function Navigation() {
  const [isOpen, setIsOpen] = useState(true);
  const location = useLocation();
  const { user } = useAuth();
  const [authLoading, setAuthLoading] = useState(false);
  const [subscribeLoading, setSubscribeLoading] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('isSubscribed') === 'true';
    return false;
  });

  const handleSignIn = async () => {
    if (!supabase) return;
    setAuthLoading(true);
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
    setAuthLoading(false);
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    setAuthLoading(true);
    await supabase.auth.signOut();
    setAuthLoading(false);
  };

  const handleSubscribe = async () => {
    if (!user) { alert('Please sign in to join the mailing list.'); return; }
    setSubscribeLoading(true);
    try {
      const response = await fetch('/api/mailing-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email }),
      });
      if (response.ok) {
        setIsSubscribed(true);
        localStorage.setItem('isSubscribed', 'true');
      } else {
        const data = await response.json();
        alert(`Error: ${data.error || 'Failed to subscribe'}`);
      }
    } catch { alert('An error occurred. Please try again later.'); }
    finally { setSubscribeLoading(false); }
  };

  const pill: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: 8,
    background: 'rgba(250,250,247,.82)',
    backdropFilter: 'blur(20px) saturate(160%)',
    border: '1px solid rgba(10,10,10,.08)',
    borderRadius: 'var(--r-pill)',
    boxShadow: '0 12px 40px rgba(10,10,10,.04), 0 1px 0 rgba(255,255,255,.5) inset',
    pointerEvents: 'auto',
  };

  return (
    <div style={{ position: 'fixed', bottom: 24, left: 0, right: 0, display: 'flex', justifyContent: 'center', zIndex: 1000, pointerEvents: 'none' }}>
      <div style={pill}>

        {/* Toggle */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', color: 'var(--ink)', border: 'none', cursor: 'pointer', transition: 'background .2s', flexShrink: 0 }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(10,10,10,.05)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          {isOpen ? <X size={18} /> : <Menu size={18} />}
        </button>

        {/* Nav items */}
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ width: 0, opacity: 0 }} animate={{ width: 'auto', opacity: 1 }} exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              style={{ overflow: 'hidden' }}
            >
              <div style={{ display: 'flex', gap: 4, paddingRight: 4 }}>
                {ROUTES.map(route => {
                  const isActive = location.pathname === route.path;
                  return (
                    <Link
                      key={route.path}
                      to={route.path}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 8,
                        padding: '11px 18px',
                        background: isActive ? ACCENT : 'transparent',
                        color: isActive ? 'var(--paper)' : 'var(--muted)',
                        border: 'none', textDecoration: 'none', borderRadius: 'var(--r-pill)',
                        fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 500,
                        letterSpacing: '.16em', textTransform: 'uppercase',
                        transition: 'background .2s, color .2s', whiteSpace: 'nowrap',
                      }}
                      onMouseEnter={e => { if (!isActive) { (e.currentTarget as HTMLElement).style.background = 'rgba(10,10,10,.05)'; (e.currentTarget as HTMLElement).style.color = 'var(--ink)'; } }}
                      onMouseLeave={e => { if (!isActive) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; } }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: isActive ? 'var(--paper)' : ACCENT, opacity: isActive ? 1 : 0.6, flexShrink: 0 }} />
                      {route.label}
                    </Link>
                  );
                })}

                {/* Join List — hidden after subscribed */}
                {!isSubscribed && (
                  <button
                    onClick={handleSubscribe}
                    disabled={subscribeLoading}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8,
                      padding: '11px 18px', background: 'transparent', color: 'var(--muted)',
                      border: '1px solid var(--rule)', borderRadius: 'var(--r-pill)',
                      fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 500,
                      letterSpacing: '.16em', textTransform: 'uppercase',
                      cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background .2s, color .2s',
                      opacity: subscribeLoading ? 0.5 : 1,
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(10,10,10,.05)'; (e.currentTarget as HTMLElement).style.color = 'var(--ink)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; }}
                  >
                    <Mail size={12} />
                    {subscribeLoading ? '...' : 'Join List'}
                  </button>
                )}

                {/* Auth — Sign Out when logged in, Sign In when not */}
                {user ? (
                  <button
                    onClick={handleSignOut}
                    disabled={authLoading}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8,
                      padding: '11px 18px', background: 'transparent', color: 'var(--muted)',
                      border: 'none', borderRadius: 'var(--r-pill)',
                      fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 500,
                      letterSpacing: '.16em', textTransform: 'uppercase',
                      cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background .2s, color .2s',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(10,10,10,.05)'; (e.currentTarget as HTMLElement).style.color = 'var(--ink)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; }}
                  >
                    <LogOut size={12} />
                    Sign Out
                  </button>
                ) : (
                  <button
                    onClick={handleSignIn}
                    disabled={authLoading}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8,
                      padding: '11px 18px', background: ACCENT, color: 'var(--paper)',
                      border: 'none', borderRadius: 'var(--r-pill)',
                      fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 500,
                      letterSpacing: '.16em', textTransform: 'uppercase',
                      cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background .2s',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--ink)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ACCENT; }}
                  >
                    <LogIn size={12} />
                    Sign In
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
