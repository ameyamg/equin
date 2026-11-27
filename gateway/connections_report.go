package main

import (
	"fmt"
	"log/slog"
	"os"
	"time"
)

// A connection that holds a backend up for nobody is a report.
//
// The idle sweeper never stops a backend with an open connection, which is
// right while something uses it — and on 2026-11-27 five promo-film backends
// stayed up 5+ hours (one for two days) on one connection each, with no
// request completed since and nobody told.
//
// What "held with no activity" means, for each kind:
//
//   - An HTTP request is counted until its handler returns. A request still in
//     flight, with no byte of body or response crossing it for heldReportAfter,
//     is stuck (a backend that never answers, a client that never reads); a
//     streaming response that writes as it goes is not.
//   - A WebSocket is long-lived by design: an open tab keeps one for hours with
//     no HTTP request, and that tab IS a use of the backend. But Bun pings an
//     idle WebSocket (its idleTimeout, 120 s by default, sendPings on) and the
//     client's pong crosses the gateway too, so a live WebSocket moves bytes at
//     least every couple of minutes. One with no byte either way for
//     heldReportAfter has a peer that is gone or frozen, or a backend that
//     stopped pinging: never a tab in use.
//
// Two rules, each filed once per connection (openConn.reported), whatever it
// does after:
//
//   - silent (any kind): a non-always-on backend with no request completed for
//     heldSilentAfter, and a connection on it with no byte either way for as
//     long. One hour: six idle timeouts (10 min) — the backend has outlived its
//     sweep by most of an hour — and thirty Bun ping intervals, so no live
//     connection reaches it.
//   - kept-alive (any kind): a non-always-on backend with no request
//     completed for heldKeptAliveAfter, and a connection on it open as long —
//     traffic or not. Silence cannot catch a client that is alive but nobody's:
//     a leaked automated browser answers Bun's pings and runs the live-state
//     client's own 20 s heartbeat (resource-protocol HEARTBEAT_MS) exactly like
//     a tab in use, and a streaming response (NDJSON, SSE) writes its beats
//     whoever reads it. At the gateway the two differ only by how long and by
//     who (the User-Agent, the remote address — which the entry names). Six
//     hours with not one request completed is past any working session on a
//     page that does anything: a forgotten tab, a leaked client, or a backend
//     holding a stream to itself — and either way the backend's memory has
//     been held for nobody. The 2026-11-27 promo-film backends were the last:
//     each held GET /api/host-only/box-link/stream (User-Agent Bun) to its own
//     namespace, a beat every 15 s, for 5+ h and, one, 2 days.

// backendHeldKind is the report kind. Declared by
// plugins/debug/plugins/backend-held (core/kind.ts), which owns the payload's
// schema; testdata/backend-held-entry.json pins this writer to it.
const backendHeldKind = "backend-held"

// The two rules' thresholds: see the top of this file.
const (
	heldSilentAfter    = time.Hour
	heldKeptAliveAfter = 6 * time.Hour
)

// Why a connection is reported (backendHeld.Reason).
const (
	heldSilent    = "silent"
	heldKeptAlive = "kept-alive"
)

// backendHeld is the `backend-held` payload: one connection holding one
// backend up.
type backendHeld struct {
	Worktree string `json:"worktree"`
	// Reason: heldSilent or heldKeptAlive; HeldAfterMs is that rule's
	// threshold.
	Reason string `json:"reason"`
	// LastActivityAt: epoch ms of the latest request completed (or WebSocket
	// opened) on the backend.
	LastActivityAt int64 `json:"lastActivityAt"`
	IdleTimeoutMs  int64 `json:"idleTimeoutMs"`
	HeldAfterMs    int64 `json:"heldAfterMs"`
	// Connection is the silent connection; OpenConnections how many the
	// backend had open in all when it was filed.
	Connection      ConnStatus `json:"connection"`
	OpenConnections int        `json:"openConnections"`
	DetectedAt      int64      `json:"detectedAt"`
}

func backendHeldMessage(h backendHeld) string {
	c := h.Connection
	idle := time.Duration(h.DetectedAt-h.LastActivityAt) * time.Millisecond
	how := "a silent"
	if h.Reason == heldKeptAlive {
		how = "a kept-alive"
	}
	return fmt.Sprintf("backend %s held up %s by %s %s %s %s (open %s, nothing crossed it for %s; from %s, User-Agent %q)",
		h.Worktree, idle.Round(time.Minute), how, c.Kind, c.Method, c.Path,
		(time.Duration(c.OpenForMs) * time.Millisecond).Round(time.Minute),
		(time.Duration(c.QuietForMs) * time.Millisecond).Round(time.Minute),
		c.RemoteAddr, c.UserAgent)
}

func newBackendHeldEntry(h backendHeld, gatewayPid int, checkout string) outboxEntry {
	return outboxEntry{
		Version:    1,
		Kind:       backendHeldKind,
		Message:    backendHeldMessage(h),
		Data:       h,
		OccurredAt: h.DetectedAt,
		Writer:     outboxWriter{Pid: gatewayPid, Checkout: checkout},
	}
}

// heldBy answers what holds w's backend up (see the top of this file), and
// marks each one answered so it is filed once. Nothing for an always-on
// backend, one not running, or one with a request completed within
// silentAfter.
func (w *Worktree) heldBy(now time.Time, silentAfter, keptAliveAfter time.Duration) []backendHeld {
	if w.AlwaysOn() {
		return nil
	}
	w.mu.Lock()
	p, running := w.phase.(phaseRunning)
	last := w.lastActivity
	w.mu.Unlock()
	idle := now.Sub(last)
	if !running || idle < silentAfter {
		return nil
	}
	conns := p.bk.openConns()
	var out []backendHeld
	for _, c := range conns {
		// One read decides and is what the entry says.
		st := c.status(now)
		var reason string
		var after time.Duration
		switch {
		case time.Duration(st.QuietForMs)*time.Millisecond >= silentAfter:
			reason, after = heldSilent, silentAfter
		case idle >= keptAliveAfter && time.Duration(st.OpenForMs)*time.Millisecond >= keptAliveAfter:
			reason, after = heldKeptAlive, keptAliveAfter
		default:
			continue
		}
		if !c.reported.CompareAndSwap(false, true) {
			continue
		}
		out = append(out, backendHeld{
			Worktree:        w.Name,
			Reason:          reason,
			LastActivityAt:  last.UnixMilli(),
			IdleTimeoutMs:   w.cfg.IdleTimeout.Milliseconds(),
			HeldAfterMs:     after.Milliseconds(),
			Connection:      st,
			OpenConnections: len(conns),
			DetectedAt:      now.UnixMilli(),
		})
	}
	return out
}

// fileHeld files every connection holding wt's backend up silently. Run on
// the idle sweeper's tick: silence has no change signal, only a clock.
func (r *Registry) fileHeld(wt *Worktree, now time.Time) {
	for _, h := range wt.heldBy(now, heldSilentAfter, heldKeptAliveAfter) {
		slog.Warn("backend held up by a connection",
			"worktree", h.Worktree, "reason", h.Reason, "kind", h.Connection.Kind, "method", h.Connection.Method,
			"path", h.Connection.Path, "remoteAddr", h.Connection.RemoteAddr,
			"userAgent", h.Connection.UserAgent, "openForMs", h.Connection.OpenForMs,
			"quietForMs", h.Connection.QuietForMs)
		if r.cfg.ReportOutboxDir == "" {
			slog.Error("backend held up and no report outbox is configured; not reported", "worktree", h.Worktree)
			continue
		}
		checkout, err := os.Executable()
		if err != nil {
			checkout = "gateway"
		}
		path, err := writeOutboxEntry(r.cfg.ReportOutboxDir, newBackendHeldEntry(h, os.Getpid(), checkout), now)
		if err != nil {
			slog.Error("backend held up and its report could not be filed", "worktree", h.Worktree, "err", err)
			continue
		}
		slog.Warn("backend held report filed", "worktree", h.Worktree, "entry", path)
	}
}
