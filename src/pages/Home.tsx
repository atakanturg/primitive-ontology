import { motion } from 'motion/react';
import { useState } from 'react';
import { useAuth } from '../lib/useAuth';
import { Mail } from 'lucide-react';

export function Home() {
  const { user } = useAuth();
  const [isSubscribed, setIsSubscribed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('isSubscribed') === 'true';
    }
    return false;
  });
  const [loading, setLoading] = useState(false);

  const handleSubscribe = async () => {
    if (!user) {
      alert("Please sign in to join the mailing list.");
      return;
    }

    setLoading(true);
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
    } catch (error) {
      alert("An error occurred. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="relative flex flex-col items-center justify-center px-4 overflow-hidden min-h-[70vh]">
      <div className="max-w-4xl w-full z-10 flex flex-col items-center justify-center">
        
        {/* Isolated container for the Logo Animation only */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
          className="relative"
        >
          {/* Logo Animation Component remains at the top; all arrows and indicators purged */}
        </motion.div>

        {!isSubscribed && (
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 2, duration: 0.8 }}
            onClick={handleSubscribe}
            disabled={loading}
            className="mt-8 flex items-center gap-2 px-8 py-3 bg-terra-ink text-white rounded-full text-[10px] font-bold uppercase tracking-[0.2em] hover:bg-white hover:text-terra-ink border border-terra-ink transition-all duration-300 shadow-xl disabled:opacity-50"
          >
            <Mail className="w-4 h-4 stroke-[2]" />
            {loading ? 'Subscribing...' : 'Join Mailing List for Live Updates'}
          </motion.button>
        )}

      </div>

      {/* Clean Background Texture */}
      <div className="absolute inset-0 opacity-[0.03] bg-[url('/noise.svg')] pointer-events-none mix-blend-overlay"></div>
    </section>
  );
}
