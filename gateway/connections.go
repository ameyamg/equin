package main

import (
	"io"
	"net/http"
	"sort"
	"sync/atomic"
	"time"
)

// Every connection the gateway proxies to a backend is a record, not a count.
//
// The idle sweeper keeps any backend with an open connection (ShouldSweep),
// and the status used to say only how many there were (activeConns). On
// 2026-11-27 five promo-film composition backends sat at activeConns 1 for 5+
// hours (one for two days) with no request completed since, and nothing could
// say what that one connection was: an in-flight HTTP request (counted until
// its handler returns) or a WebSocket (counted until it closes), from whom, to
// which path. lsof showed the gateway's leg into the backend and nothing more.
//
// Now each one carries what it is (HTTP or WebSocket, method, path — never the
// query, which can carry a token —, the client's User-Agent, Origin and
// Sec-Fetch metadata, the principal it was stamped, its remote address — the
// client's ephemeral port, which `lsof -iTCP:<port>` maps to the client
// process —), when it opened, and the bytes that crossed it each way and when
// the last one did. GET /gateway/connections lists them per backend
// (connections_report.go files the ones that hold a backend up silently).

const (
	connHTTP      = "http"
	connWebSocket = "websocket"
)

// connSeq numbers connections across the gateway's life, so one can be told
// from another in two reads of the list.
var connSeq atomic.Uint64

// connClock is the base lastByteNs counts from (see openConn).
var connClock = time.Now()

// openConn is one connection proxied to a backend. The request fields are
// fixed at open; the byte counters move while it lives.
type openConn struct {
	id           uint64
	kind         string
	method       string
	host         string
	path         string
	userAgent    string
	origin       string
	secFetchSite string
	secFetchMode string
	secFetchDest string
	principal    string
	remoteAddr   string
	openedAt     time.Time

	// bytesIn: client → backend (the request body, or the WebSocket's client
	// frames); bytesOut: backend → client.
	bytesIn  atomic.Int64
	bytesOut atomic.Int64
	// lastByteNs: when the latest byte crossed either way, as nanoseconds
	// after connClock (0 while none) — on the monotonic clock, like openedAt
	// and the worktree's lastActivity, so a machine sleep cannot make a
	// pinging connection look hours quiet (wall time runs through a sleep,
	// the monotonic clock does not).
	lastByteNs atomic.Int64
	// reported: a backend-held entry already names it (connections_report.go).
	reported atomic.Bool
}

func newOpenConn(kind string, r *http.Request, now time.Time) *openConn {
	return &openConn{
		id:           connSeq.Add(1),
		kind:         kind,
		method:       r.Method,
		host:         cutLine(r.Host),
		path:         cutLine(r.URL.Path),
		userAgent:    cutLine(r.Header.Get("User-Agent")),
		origin:       cutLine(r.Header.Get("Origin")),
		secFetchSite: cutLine(r.Header.Get("Sec-Fetch-Site")),
		secFetchMode: cutLine(r.Header.Get("Sec-Fetch-Mode")),
		secFetchDest: cutLine(r.Header.Get("Sec-Fetch-Dest")),
		principal:    r.Header.Get(principalHeader),
		remoteAddr:   r.RemoteAddr,
		openedAt:     now,
	}
}

// moved records n bytes crossing the connection, inbound (client → backend)
// or not.
func (c *openConn) moved(n int, inbound bool) {
	if n <= 0 {
		return
	}
	if inbound {
		c.bytesIn.Add(int64(n))
	} else {
		c.bytesOut.Add(int64(n))
	}
	c.lastByteNs.Store(max(int64(time.Since(connClock)), 1))
}

// quietSince is when the connection last moved a byte, or opened if it never
// did.
func (c *openConn) quietSince() time.Time {
	if ns := c.lastByteNs.Load(); ns > 0 {
		return connClock.Add(time.Duration(ns))
	}
	return c.openedAt
}

// ConnStatus is one connection as GET /gateway/connections answers it, and as
// a backend-held report carries it (the plugins/debug/plugins/backend-held
// schema mirrors it strictly).
type ConnStatus struct {
	ID           uint64 `json:"id"`
	Kind         string `json:"kind"`
	Method       string `json:"method"`
	Host         string `json:"host"`
	Path         string `json:"path"`
	UserAgent    string `json:"userAgent"`
	Origin       string `json:"origin"`
	SecFetchSite string `json:"secFetchSite"`
	SecFetchMode string `json:"secFetchMode"`
	SecFetchDest string `json:"secFetchDest"`
	Principal    string `json:"principal"`
	RemoteAddr   string `json:"remoteAddr"`
	// OpenedAt and LastByteAt are epoch ms (LastByteAt 0: no byte yet);
	// OpenForMs and QuietForMs are as of the read.
	OpenedAt   int64 `json:"openedAt"`
	OpenForMs  int64 `json:"openForMs"`
	BytesIn    int64 `json:"bytesIn"`
	BytesOut   int64 `json:"bytesOut"`
	LastByteAt int64 `json:"lastByteAt"`
	QuietForMs int64 `json:"quietForMs"`
}

func (c *openConn) status(now time.Time) ConnStatus {
	var lastByteAt int64
	quiet := c.quietSince()
	if c.lastByteNs.Load() > 0 {
		lastByteAt = quiet.UnixMilli()
	}
	return ConnStatus{
		ID:           c.id,
		Kind:         c.kind,
		Method:       c.method,
		Host:         c.host,
		Path:         c.path,
		UserAgent:    c.userAgent,
		Origin:       c.origin,
		SecFetchSite: c.secFetchSite,
		SecFetchMode: c.secFetchMode,
		SecFetchDest: c.secFetchDest,
		Principal:    c.principal,
		RemoteAddr:   c.remoteAddr,
		OpenedAt:     c.openedAt.UnixMilli(),
		OpenForMs:    now.Sub(c.openedAt).Milliseconds(),
		BytesIn:      c.bytesIn.Load(),
		BytesOut:     c.bytesOut.Load(),
		LastByteAt:   lastByteAt,
		QuietForMs:   now.Sub(quiet).Milliseconds(),
	}
}

// openConns lists every connection open on b, oldest first.
func (b *backend) openConns() []*openConn {
	b.connMu.Lock()
	out := make([]*openConn, 0, len(b.httpConns)+len(b.ws))
	for c := range b.httpConns {
		out = append(out, c)
	}
	for _, c := range b.ws {
		out = append(out, c)
	}
	b.connMu.Unlock()
	sort.Slice(out, func(i, j int) bool { return out[i].id < out[j].id })
	return out
}

// countingBody counts a proxied request's body as it is read.
type countingBody struct {
	io.ReadCloser
	conn *openConn
}

func (b countingBody) Read(p []byte) (int, error) {
	n, err := b.ReadCloser.Read(p)
	b.conn.moved(n, true)
	return n, err
}

// countingResponse counts a proxied response's bytes as they are written. It
// unwraps for http.ResponseController (the reverse proxy flushes and, for an
// upgrade, hijacks through it).
type countingResponse struct {
	http.ResponseWriter
	conn *openConn
}

func (w countingResponse) Write(p []byte) (int, error) {
	n, err := w.ResponseWriter.Write(p)
	w.conn.moved(n, false)
	return n, err
}

func (w countingResponse) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// countingWriter counts one leg of a proxied WebSocket.
type countingWriter struct {
	w       io.Writer
	conn    *openConn
	inbound bool
}

func (cw countingWriter) Write(p []byte) (int, error) {
	n, err := cw.w.Write(p)
	cw.conn.moved(n, cw.inbound)
	return n, err
}

// BackendConnections is one backend's open connections, as
// GET /gateway/connections answers them.
type BackendConnections struct {
	Worktree string `json:"worktree"`
	State    string `json:"state"`
	// AlwaysOn: never swept for idleness (central, main), so its connections
	// do not hold it up.
	AlwaysOn bool `json:"alwaysOn"`
	// LastActivity: epoch ms of the latest request completed (or WebSocket
	// opened) — the idle sweeper's clock.
	LastActivity int64        `json:"lastActivity"`
	Connections  []ConnStatus `json:"connections"`
}

// connectionsOf lists the serving backend's open connections.
func (w *Worktree) connectionsOf(now time.Time) (BackendConnections, bool) {
	w.mu.Lock()
	state := w.phase.state()
	last := w.lastActivity
	bk := backendOf(w.phase)
	w.mu.Unlock()
	if bk == nil {
		return BackendConnections{}, false
	}
	conns := bk.openConns()
	out := BackendConnections{
		Worktree:     w.Name,
		State:        state.String(),
		AlwaysOn:     w.AlwaysOn(),
		LastActivity: last.UnixMilli(),
		Connections:  make([]ConnStatus, 0, len(conns)),
	}
	for _, c := range conns {
		out.Connections = append(out.Connections, c.status(now))
	}
	return out, true
}
