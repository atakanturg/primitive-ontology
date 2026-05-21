import { motion } from 'motion/react';

const RESPONSIVE = `
  .onto-hero { padding: 200px 96px 80px; }
  .onto-quote { margin: 80px auto 96px; padding: 56px 80px; }
  .onto-quote q { font-size: 44px; }
  .onto-steps { padding: 96px; }
  .onto-steps-grid { grid-template-columns: repeat(3, 1fr); gap: 56px; }
  .onto-sources { padding: 32px 96px 120px; }
  .onto-sources-grid { grid-template-columns: repeat(7, 1fr); gap: 12px; }
  .onto-cta { padding: 64px 96px; margin: 0 auto 120px; }
  .onto-cta-title { font-size: 56px; }
  @media (max-width: 1100px) {
    .onto-hero { padding: 140px 48px 64px; }
    .onto-quote { padding: 40px 48px; }
    .onto-quote q { font-size: 34px; }
    .onto-steps { padding: 64px 48px; }
    .onto-sources { padding: 24px 48px 96px; }
    .onto-sources-grid { grid-template-columns: repeat(4, 1fr); }
    .onto-cta { padding: 48px; }
    .onto-cta-title { font-size: 44px; }
  }
  @media (max-width: 768px) {
    .onto-hero { padding: 120px 24px 48px; }
    .onto-hero h1 { font-size: clamp(40px, 10vw, 72px) !important; }
    .onto-hero p { font-size: 16px !important; }
    .onto-quote { margin: 48px 24px 64px; padding: 32px 24px; }
    .onto-quote q { font-size: 26px; }
    .onto-steps { padding: 48px 24px; }
    .onto-steps-grid { grid-template-columns: 1fr !important; gap: 40px; }
    .onto-sources { padding: 16px 24px 80px; }
    .onto-sources-grid { grid-template-columns: repeat(3, 1fr) !important; gap: 8px; }
    .onto-cta { padding: 32px 24px; flex-direction: column !important; align-items: flex-start !important; margin: 0 24px 80px; }
    .onto-cta-title { font-size: 32px; }
  }
`;

const rise = {
  hidden: { y: 18 },
  visible: { y: 0, transition: { duration: 0.9, ease: [0.2, 0.7, 0.3, 1] as [number, number, number, number] } },
};

const stepFade = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.2, 0.7, 0.3, 1] as [number, number, number, number] } },
};

const sourceFade = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.4, ease: [0.2, 0.7, 0.3, 1] as [number, number, number, number] } },
};

export function Home() {
  return (
    <div style={{ background: 'var(--paper)' }}>
      <style>{RESPONSIVE}</style>
      {/* SECTION 1: HERO */}
      <section className="onto-hero" style={{
        maxWidth: 1080,
        margin: '0 auto',
        textAlign: 'center',
      }}>
        <motion.div
          variants={rise}
          initial="hidden"
          animate="visible"
        >
          <h1 style={{
            fontFamily: 'var(--f-display)',
            fontWeight: 400,
            fontSize: 84,
            lineHeight: 1.04,
            letterSpacing: '-.025em',
            color: 'var(--ink)',
            margin: 0,
            marginBottom: 36,
          }}>
            Equity research,<br />
            <span className="hand">automated</span>
          </h1>

          <p style={{
            fontFamily: 'var(--f-body)',
            fontSize: 19,
            lineHeight: 1.65,
            color: 'var(--ink-2)',
            maxWidth: 660,
            margin: '0 auto',
          }}>
            Politician trades, FDA filings, SEC filings, port logs, earnings transcripts, research papers. All structured through a custom model.
          </p>
        </motion.div>
      </section>

      {/* SECTION 2: PULL QUOTE */}
      <section className="onto-quote" style={{
        maxWidth: 1080,
        borderTop: '1px solid var(--ink)',
        borderBottom: '1px solid var(--ink)',
        textAlign: 'center',
      }}>
        <motion.blockquote
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true, margin: '-100px' }}
          className="onto-quote"
          style={{
            fontFamily: 'var(--f-display)',
            fontStyle: 'italic',
            lineHeight: 1.25,
            color: 'var(--accent)',
            margin: 0,
            fontWeight: 400,
          }}
        >
          "The Ontology transforms your digital assets into a dynamic, actionable representation of the business for all users to leverage."
        </motion.blockquote>
        <motion.span
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          viewport={{ once: true, margin: '-100px' }}
          style={{
            fontFamily: 'var(--f-body)',
            fontSize: 15,
            color: 'var(--muted)',
            display: 'block',
            marginTop: 24,
          }}
        >
          Palantir
        </motion.span>
      </section>

      {/* SECTION 3: HOW IT WORKS */}
      <section className="onto-steps" style={{
        maxWidth: 1280,
        margin: '0 auto',
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          paddingBottom: 14,
          borderBottom: '1px solid var(--ink)',
          marginBottom: 56,
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          color: 'var(--ink)',
        }}>
          How it works · 03
        </div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          variants={{ visible: { transition: { staggerChildren: 0.12 } } }}
          className="onto-steps-grid"
          style={{
            display: 'grid',
          }}
        >
          {[
            { num: '01', badge: 'INGEST', title: 'Ingest', desc: 'Residential-proxy chains scrape primary sources every cycle.' },
            { num: '02', badge: 'STRUCTURE', title: 'Structure', desc: 'A fine-tuned model weighs every signal into a single ontology.' },
            { num: '03', badge: 'ASK', title: 'Ask', desc: 'Ask in plain English. Get a cited paragraph back.' },
          ].map((step, idx) => (
            <motion.article key={idx} variants={stepFade}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                <span style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: '.1em',
                  color: 'var(--muted-2)',
                }}>
                  {step.num}
                </span>
                <span style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 9,
                  fontWeight: 500,
                  letterSpacing: '.18em',
                  textTransform: 'uppercase',
                  color: 'var(--accent)',
                }}>
                  {step.badge}
                </span>
              </div>
              <div style={{
                width: 24,
                height: 2,
                background: 'var(--accent)',
                marginBottom: 32,
              }} />
              <h3 style={{
                fontFamily: 'var(--f-display)',
                fontSize: 36,
                lineHeight: 1,
                letterSpacing: '-.005em',
                color: 'var(--ink)',
                margin: 0,
                marginBottom: 16,
              }}>
                {step.title}
              </h3>
              <p style={{
                fontFamily: 'var(--f-body)',
                fontSize: 14,
                lineHeight: 1.6,
                color: 'var(--ink-2)',
                margin: 0,
              }}>
                {step.desc}
              </p>
            </motion.article>
          ))}
        </motion.div>
      </section>

      {/* SECTION 4: SOURCES */}
      <section className="onto-sources" style={{
        maxWidth: 1280,
        margin: '0 auto',
      }}>
        <div style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          color: 'var(--ink)',
          marginBottom: 56,
        }}>
          Sources · 07
        </div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
          className="onto-sources-grid"
          style={{
            display: 'grid',
          }}
        >
          {[
            'SEC\nFILINGS',
            'FDA\nFILINGS',
            'POLITICIAN\nTRADES',
            'PORT\nLOGS',
            'EARNINGS\nCALLS',
            'RESEARCH\nPAPERS',
            'PATENT\nFILINGS',
          ].map((source, idx) => (
            <motion.button
              key={idx}
              variants={sourceFade}
              style={{
                aspectRatio: '1',
                border: '1px solid var(--rule)',
                background: 'transparent',
                color: 'var(--ink)',
                fontFamily: 'var(--f-mono)',
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                lineHeight: 1.3,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                padding: 12,
                transition: 'background .25s, color .25s, border-color .25s',
                whiteSpace: 'pre-line',
              }}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLElement;
                el.style.background = 'var(--accent)';
                el.style.color = 'var(--paper)';
                el.style.borderColor = 'var(--accent)';
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLElement;
                el.style.background = 'transparent';
                el.style.color = 'var(--ink)';
                el.style.borderColor = 'var(--rule)';
              }}
            >
              {source}
            </motion.button>
          ))}
        </motion.div>
      </section>

      {/* SECTION 5: CTA BAND */}
      <section className="onto-cta" style={{
        maxWidth: 1280,
        background: 'var(--accent)',
        backgroundImage: 'radial-gradient(circle, rgba(255,255,255,.5) .7px, transparent .7px)',
        backgroundSize: '14px 14px',
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 48,
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span className="onto-cta-title" style={{
            fontFamily: 'var(--f-display)',
            lineHeight: 1,
            letterSpacing: '-.02em',
            color: 'var(--paper)',
            fontWeight: 400,
            margin: 0,
            display: 'block',
          }}>
            Secure the data.
          </span>
          <span style={{
            fontFamily: 'var(--f-body)',
            fontSize: 14,
            lineHeight: 1.5,
            color: 'rgba(255,255,255,.65)',
          }}>
            Access Primitive Ontology.
          </span>
        </div>

        <a
          href="https://ontology.primitive-os.cc"
          className="btn btn-on-ink"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '14px 22px',
            background: 'var(--paper)',
            color: 'var(--ink)',
            border: '1px solid var(--paper)',
            borderRadius: '999px',
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '.16em',
            textTransform: 'uppercase',
            textDecoration: 'none',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            transition: 'background .2s, color .2s',
          }}
        >
          Open Ontology →
        </a>
      </section>
    </div>
  );
}
