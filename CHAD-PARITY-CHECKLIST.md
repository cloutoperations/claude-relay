# Chad (Clay v3) Feature Parity Checklist

Features from chadbyte's claude-relay that we don't have yet, categorized by priority.

---

## Category 1 — Mobile & Remote Access

- [ ] **1.1 Tailscale IP detection** — Scan network interfaces for `100.x.x.x`, prioritize over LAN IPs
- [ ] **1.2 mkcert HTTPS** — Auto-generate TLS certs with all LAN + Tailscale IPs as SANs
- [ ] **1.3 PWA setup wizard** — Multi-step onboarding: cert install, Add to Home Screen, push subscribe (detect iOS/Android/desktop)
- [ ] **1.4 Mobile CSS** — `100dvh`, `env(safe-area-inset-*)`, `viewport-fit: cover`, tap highlight, touch scale feedback
- [ ] **1.5 Service worker (smart push)** — Only fire push notifications when app is backgrounded
- [ ] **1.6 QR code in CLI** — Print scannable QR with server URL for quick phone connect

## Category 2 — Security

- [ ] **2.1 PIN auth** — 6-digit PIN, SHA256 hashed, rate-limited (5 attempts → 15min lockout)

## Category 3 — UI/UX Enhancements

- [ ] **3.1 AskUser multi-option UI** — Render SDK `AskUserQuestion` with clickable option buttons, single/multi-select, preview snippets, "Other..." freeform fallback
- [ ] **3.2 Bundled themes (20+)** — Catppuccin, Dracula, Nord, Gruvbox, Tokyo Night, Solarized, Rose Pine, Everforest, Monokai, One Dark/Light, GitHub Light
- [ ] **3.3 Chunk-based streaming** — Buffer tokens, reveal in phrase-sized chunks every 60ms (smoother than word-by-word)
- [ ] **3.4 Settings overlay** — Full-screen Discord-style settings panel (overview, models, permissions, notifications, appearance, advanced)
- [ ] **3.5 Dark mode favicons** — Theme-aware icons that switch with dark/light
- [ ] **3.6 Image resize on upload** — Auto-downsize images >5MB to JPEG before sending

## Category 4 — Automation & Intelligence

- [ ] **4.1 Rewind mode** — Restore conversation to any previous message (chat-only, files-only, or both)
- [ ] **4.2 Agent strategic tasks** — status-check (GTD + git → honest present state), gate-check (test criteria vs repo evidence), drift-check (planned vs actual commit activity), update-dashboard (session summaries → cockpit-state.json)

## Category 5 — System & DX

- [ ] **5.1 Keep awake** — macOS `caffeinate -di` toggle so machine doesn't sleep during long runs
- [ ] **5.2 CLI session picker** — Select/manage sessions from terminal
- [ ] **5.3 Config auto-migration** — Graceful path migration with backward compat

---

## Implementation Order (suggested)

1. **Mobile & Remote** (1.1–1.6) — unlocks phone access, biggest lifestyle upgrade
2. **AskUser multi-option** (3.1) — SDK feature, quick win
3. **PIN auth** (2.1) — needed before exposing over Tailscale
4. **Themes** (3.2) — drop in JSON files, easy
5. **Chunk streaming** (3.3) — smoother UX
6. **Keep awake** (5.1) — one-liner
7. **Rewind** (4.1) — complex but powerful
8. **Settings overlay** (3.4) — nice to have
9. **Agent strategic tasks** (4.2) — builds on existing agent infra
10. **Rest** (3.5, 3.6, 5.2, 5.3) — polish
