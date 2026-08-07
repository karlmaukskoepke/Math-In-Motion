/*
  emailCapture.js — shared post-recording popup for GraFables.

  Fires once per browser, after the FIRST completed recording, on any
  tracking mode, on either quickstart.html or fulllab.html. Presents a
  student/educator fork:
    - Student  -> friendly dismissal, no data collected, ever.
    - Educator -> inline Kit (ConvertKit) email form, posts directly to
                  Kit's hosted endpoint. This page never sees or stores
                  the address.

  Deliberately ONE fixed visual look everywhere (Karl's call) — colors are
  hardcoded below rather than pulled from each page's --var() theme, so it
  reads identically on the light-mode Full Lab, dark-mode Full Lab, and
  Quick Start. Do not swap these to var(--accent) etc. without re-deciding
  that.

  Usage from a tool page, inside stopRecording() after confirming a real
  recording happened (data.length >= 2):
      EmailCapture.maybeShow();
  The module owns its own "have we shown this before" check — callers
  don't need to gate on that themselves.
*/

const EmailCapture = (() => {
  const SEEN_KEY = 'mm_email_capture_seen';

  // Kit (ConvertKit) hosted form endpoint. Raw fields only — no Kit JS,
  // no Kit CSS, so it never fights this module's own styling.
  const KIT_ACTION = 'https://app.kit.com/forms/9760904/subscriptions';
  const KIT_EMAIL_FIELD = 'email_address';
  // Honeypot — invisible to humans, catches bots that auto-fill every
  // field. Must stay present and stay hidden; do not remove.
  const KIT_HONEYPOT_FIELD = 'fields[undefined]';

  let injected = false;
  let rootEl = null;

  function hasBeenSeen() {
    try { return localStorage.getItem(SEEN_KEY) === '1'; }
    catch (e) { return false; }
  }

  function markSeen() {
    try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) {}
  }

  function injectStyles() {
    if (document.getElementById('mm-email-capture-styles')) return;
    const style = document.createElement('style');
    style.id = 'mm-email-capture-styles';
    style.textContent = `
      .mmec-backdrop {
        position: fixed; inset: 0; z-index: 9999;
        background: rgba(6, 7, 12, 0.72);
        backdrop-filter: blur(3px);
        display: flex; align-items: center; justify-content: center;
        padding: 20px;
        opacity: 0;
        transition: opacity 220ms ease;
      }
      .mmec-backdrop.mmec-visible { opacity: 1; }

      .mmec-card {
        width: 100%; max-width: 420px;
        background: #14161f;
        border: 1px solid #2e3356;
        border-radius: 14px;
        box-shadow: 0 0 0 1px rgba(0,229,255,0.08), 0 24px 60px rgba(0,0,0,0.55), 0 0 40px rgba(0,229,255,0.06);
        padding: 32px 28px 24px;
        font-family: 'DM Sans', sans-serif;
        color: #e8eaf6;
        transform: translateY(10px) scale(0.98);
        transition: transform 220ms ease;
        position: relative;
      }
      .mmec-backdrop.mmec-visible .mmec-card { transform: translateY(0) scale(1); }

      .mmec-close {
        position: absolute; top: 12px; right: 12px;
        width: 28px; height: 28px; border-radius: 8px;
        background: transparent; border: 1px solid #2e3356;
        color: #7986cb; font-family: 'Space Mono', monospace; font-size: 0.8rem;
        cursor: pointer; display: flex; align-items: center; justify-content: center;
        transition: border-color 150ms ease, color 150ms ease;
      }
      .mmec-close:hover { border-color: #00e5ff; color: #00e5ff; }

      .mmec-eyebrow {
        font-family: 'Space Mono', monospace;
        font-size: 0.68rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #00e5ff;
        margin-bottom: 10px;
      }
      .mmec-headline {
        font-family: 'Space Mono', monospace;
        font-weight: 700;
        font-size: 1.3rem;
        line-height: 1.35;
        margin-bottom: 22px;
        color: #ffffff;
      }

      .mmec-choices { display: flex; flex-direction: column; gap: 10px; }
      .mmec-choice-btn {
        display: flex; flex-direction: column; align-items: flex-start;
        gap: 3px;
        width: 100%;
        background: #1a1d27;
        border: 1px solid #2e3356;
        border-radius: 10px;
        padding: 14px 16px;
        cursor: pointer;
        text-align: left;
        transition: border-color 150ms ease, background 150ms ease, transform 150ms ease;
      }
      .mmec-choice-btn:hover {
        border-color: #00e5ff;
        background: #1e2230;
        transform: translateY(-1px);
      }
      .mmec-choice-label {
        font-family: 'Space Mono', monospace;
        font-weight: 700;
        font-size: 0.95rem;
        color: #ffffff;
      }
      .mmec-choice-sub {
        font-size: 0.8rem;
        color: #7986cb;
      }

      .mmec-dismiss {
        font-family: 'Space Mono', monospace;
        font-weight: 700;
        font-size: 1.1rem;
        color: #69f0ae;
        text-align: center;
        padding: 18px 0 8px;
      }

      .mmec-form { display: flex; flex-direction: column; gap: 12px; }
      .mmec-form-sub {
        font-size: 0.85rem;
        color: #b8bfe8;
        line-height: 1.5;
        margin-bottom: 4px;
      }
      .mmec-input {
        width: 100%;
        background: #0f1117;
        border: 1px solid #2e3356;
        border-radius: 8px;
        padding: 12px 14px;
        font-family: 'DM Sans', sans-serif;
        font-size: 0.95rem;
        color: #e8eaf6;
        outline: none;
        transition: border-color 150ms ease;
      }
      .mmec-input::placeholder { color: #7986cb; opacity: 0.8; }
      .mmec-input:focus { border-color: #00e5ff; }

      .mmec-honeypot {
        position: absolute !important;
        left: -9999px !important;
        width: 1px; height: 1px;
        overflow: hidden;
      }

      .mmec-submit {
        width: 100%;
        background: #00e5ff;
        color: #0a0c12;
        border: none;
        border-radius: 8px;
        padding: 12px 16px;
        font-family: 'Space Mono', monospace;
        font-weight: 700;
        font-size: 0.9rem;
        cursor: pointer;
        transition: background 150ms ease, transform 150ms ease;
      }
      .mmec-submit:hover { background: #33ebff; transform: translateY(-1px); }
      .mmec-submit:disabled { opacity: 0.6; cursor: default; transform: none; }

      .mmec-disclaimer {
        font-size: 0.72rem;
        color: #7986cb;
        text-align: center;
        margin-top: 2px;
      }

      .mmec-success {
        font-family: 'Space Mono', monospace;
        font-weight: 700;
        font-size: 1rem;
        color: #69f0ae;
        text-align: center;
        padding: 10px 0;
      }
      .mmec-success-sub {
        font-size: 0.85rem;
        color: #b8bfe8;
        text-align: center;
        margin-top: 6px;
        line-height: 1.5;
      }

      .mmec-back {
        background: none; border: none;
        color: #7986cb;
        font-family: 'DM Sans', sans-serif;
        font-size: 0.78rem;
        cursor: pointer;
        text-decoration: underline;
        align-self: flex-start;
        padding: 0;
        margin-top: 2px;
      }
      .mmec-back:hover { color: #00e5ff; }

      @media (prefers-reduced-motion: reduce) {
        .mmec-backdrop, .mmec-card { transition: none; }
      }
    `;
    document.head.appendChild(style);
  }

  function buildCard() {
    const backdrop = document.createElement('div');
    backdrop.className = 'mmec-backdrop';
    backdrop.innerHTML = `
      <div class="mmec-card" role="dialog" aria-modal="true" aria-label="Stay in touch">
        <button class="mmec-close" aria-label="Close">✕</button>
        <div class="mmec-body"></div>
      </div>
    `;
    return backdrop;
  }

  function renderFork(bodyEl) {
    bodyEl.innerHTML = `
      <div class="mmec-eyebrow">GraFables</div>
      <div class="mmec-headline">Nice graph! Want to hear when new tools and games ship?</div>
      <div class="mmec-choices">
        <button class="mmec-choice-btn" data-choice="student">
          <span class="mmec-choice-label">I'm a student</span>
          <span class="mmec-choice-sub">just exploring</span>
        </button>
        <button class="mmec-choice-btn" data-choice="educator">
          <span class="mmec-choice-label">I'm an educator</span>
          <span class="mmec-choice-sub">get occasional updates</span>
        </button>
      </div>
    `;
    bodyEl.querySelector('[data-choice="student"]').onclick = () => renderDismiss(bodyEl);
    bodyEl.querySelector('[data-choice="educator"]').onclick = () => renderForm(bodyEl);
  }

  function renderDismiss(bodyEl) {
    bodyEl.innerHTML = `<div class="mmec-dismiss">Welcome — go make some graphs!</div>`;
    setTimeout(close, 1400);
  }

  // A hidden iframe as the form's submit target. This is a real browser
  // form POST (a navigation, not a script-initiated fetch), so it's not
  // subject to CORS and — importantly — it's not the kind of call ad
  // blockers / privacy extensions intercept the way they intercept
  // fetch()/XHR calls to third-party domains. Kit's own JS-free embed
  // relies on the same mechanism (just target="_top" instead of an
  // iframe, which would navigate away from the site entirely).
  function ensureTargetFrame() {
    let frame = document.getElementById('mmec-target-frame');
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = 'mmec-target-frame';
      frame.name = 'mmec-target-frame';
      frame.style.display = 'none';
      document.body.appendChild(frame);
    }
    return frame;
  }

  function renderForm(bodyEl) {
    ensureTargetFrame();
    bodyEl.innerHTML = `
      <div class="mmec-eyebrow">For Educators</div>
      <div class="mmec-headline">Get occasional updates</div>
      <form class="mmec-form" action="${KIT_ACTION}" method="post" target="mmec-target-frame">
        <div class="mmec-form-sub">New tools, games, and classroom resources — including early access when the next one ships. No spam, unsubscribe any time.</div>
        <input class="mmec-input" type="email" name="${KIT_EMAIL_FIELD}" placeholder="you@school.edu" required autocomplete="email">
        <input class="mmec-honeypot" type="text" name="${KIT_HONEYPOT_FIELD}" tabindex="-1" autocomplete="off">
        <button class="mmec-submit" type="submit">Subscribe</button>
        <div class="mmec-disclaimer">We won't send spam. Unsubscribe at any time.</div>
        <button type="button" class="mmec-back">&larr; back</button>
      </form>
    `;
    bodyEl.querySelector('.mmec-back').onclick = () => renderFork(bodyEl);

    const form = bodyEl.querySelector('.mmec-form');
    form.onsubmit = () => {
      // Don't preventDefault — let the browser actually submit the form
      // to the hidden iframe. We can't read the cross-origin response
      // either way, so update our own UI in parallel rather than wait
      // on it. Kit's confirmation email is the real signal of success.
      const btn = form.querySelector('.mmec-submit');
      btn.disabled = true;
      btn.textContent = 'Sending…';
      setTimeout(() => renderSuccess(bodyEl), 900);
    };
  }

  function renderSuccess(bodyEl) {
    bodyEl.innerHTML = `
      <div class="mmec-success">You're in!</div>
      <div class="mmec-success-sub">Check your email to confirm your subscription.</div>
    `;
    setTimeout(close, 2200);
  }

  function close() {
    if (!rootEl) return;
    rootEl.classList.remove('mmec-visible');
    setTimeout(() => {
      if (rootEl && rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
      rootEl = null;
    }, 220);
  }

  function show() {
    if (rootEl) return; // already open
    injectStyles();
    rootEl = buildCard();
    document.body.appendChild(rootEl);
    renderFork(rootEl.querySelector('.mmec-body'));

    rootEl.querySelector('.mmec-close').onclick = close;
    rootEl.addEventListener('click', (e) => {
      if (e.target === rootEl) close();
    });

    // next frame, so the transition actually runs
    requestAnimationFrame(() => rootEl.classList.add('mmec-visible'));

    markSeen();
  }

  function maybeShow() {
    if (hasBeenSeen()) return;
    show();
  }

  return { maybeShow };
})();
