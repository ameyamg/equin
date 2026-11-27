package main

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"syscall"
	"testing"
	"time"
)

// The entry the writer builds is the shape the TypeScript side reads:
// testdata/backend-held-entry.json is parsed by the backend-held kind's own
// test (plugins/debug/plugins/backend-held/core/kind.test.ts).
func TestBackendHeldEntryMatchesTheGolden(t *testing.T) {
	h := backendHeld{
		Worktree:       "promo-film.att-1795752888-nua188",
		Reason:         heldSilent,
		LastActivityAt: 1795752771019,
		IdleTimeoutMs:  600000,
		HeldAfterMs:    3600000,
		Connection: ConnStatus{
			ID:           42,
			Kind:         "websocket",
			Method:       "GET",
			Host:         "promo-film.att-1795752888-nua188.localhost:8700",
			Path:         "/ws/notifications",
			UserAgent:    "Mozilla/5.0 HeadlessChrome/131.0",
			Origin:       "http://promo-film.att-1795752888-nua188.localhost:8700",
			SecFetchSite: "same-origin",
			SecFetchMode: "websocket",
			SecFetchDest: "empty",
			Principal:    "owner",
			RemoteAddr:   "127.0.0.1:61234",
			OpenedAt:     1795752770000,
			OpenForMs:    18000000,
			BytesIn:      1200,
			BytesOut:     5300,
			LastByteAt:   1795752771000,
			QuietForMs:   17999000,
		},
		OpenConnections: 1,
		DetectedAt:      1795770770000,
	}
	got, err := json.Marshal(newBackendHeldEntry(h, 1234, "/x/gateway"))
	if err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile(filepath.Join("testdata", "backend-held-entry.json"))
	if err != nil {
		t.Fatal(err)
	}
	var g, w any
	if err := json.Unmarshal(got, &g); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(want, &w); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(g, w) {
		t.Fatalf("entry drifted from testdata/backend-held-entry.json:\n got %s", got)
	}
}

func heldTestWorktree(t *testing.T, name string, lastActivity time.Time) (*Worktree, *backend) {
	t.Helper()
	cfg := &Config{SocketsDir: shortTempDir(t), IdleTimeout: 10 * time.Minute, ChildEnv: testChildEnv(t)}
	wt := idleRunningWorktree(t, NewRegistry(cfg), name)
	wt.mu.Lock()
	wt.lastActivity = lastActivity
	bk := backendOf(wt.phase)
	wt.mu.Unlock()
	return wt, bk
}

func connOpenedAt(kind, path string, at time.Time) *openConn {
	r := httptest.NewRequest(http.MethodGet, "http://x.localhost:8700"+path+"?token=secret", nil)
	r.Header.Set("User-Agent", "HeadlessChrome")
	r.Header.Set("Sec-Fetch-Mode", "websocket")
	r.RemoteAddr = "127.0.0.1:61234"
	return newOpenConn(kind, r, at)
}

// The rule (connections_report.go): a non-always-on backend with no request
// completed for the threshold, and a connection on it with nothing crossing
// it for as long — each filed once.
func TestHeldByNamesTheSilentConnectionOnce(t *testing.T) {
	now := time.Now()
	wt, bk := heldTestWorktree(t, "promo-film.x", now.Add(-5*time.Hour))
	silent := connOpenedAt(connWebSocket, "/ws/notifications", now.Add(-5*time.Hour))
	pinging := connOpenedAt(connWebSocket, "/ws/live", now.Add(-5*time.Hour))
	pinging.moved(2, false) // a Bun ping a moment ago
	stuck := connOpenedAt(connHTTP, "/api/slow", now.Add(-2*time.Hour))
	fresh := connOpenedAt(connHTTP, "/api/new", now.Add(-time.Minute))
	bk.addWS(&closeRecorder{}, silent)
	bk.addWS(&closeRecorder{}, pinging)
	bk.openHTTP(stuck)
	bk.openHTTP(fresh)

	held := wt.heldBy(now, time.Hour, 6*time.Hour)
	if len(held) != 2 || held[0].Connection.Path != "/ws/notifications" || held[1].Connection.Path != "/api/slow" || held[0].Reason != heldSilent {
		t.Fatalf("held = %+v, want the silent WebSocket and the stuck request", held)
	}
	h := held[0]
	if h.OpenConnections != 4 || h.Connection.UserAgent != "HeadlessChrome" || h.Connection.RemoteAddr != "127.0.0.1:61234" ||
		h.Connection.Kind != connWebSocket || h.Connection.SecFetchMode != "websocket" || h.IdleTimeoutMs != 600000 {
		t.Fatalf("entry = %+v", h)
	}
	if strings.Contains(h.Connection.Path, "secret") {
		t.Fatal("the query must never be recorded")
	}
	// Half an hour on, the two filed are still silent, and filed no more.
	if again := wt.heldBy(now.Add(30*time.Minute), time.Hour, 6*time.Hour); len(again) != 0 {
		t.Fatalf("a connection already filed was filed again: %+v", again)
	}
}

// A connection that moves bytes (a pinging WebSocket, a streaming response) is
// no silent connection, but one that alone has kept a backend up past the
// kept-alive threshold is reported as such; a younger one is not.
func TestHeldByNamesAKeptAliveWebSocket(t *testing.T) {
	now := time.Now()
	wt, bk := heldTestWorktree(t, "promo-film.y", now.Add(-7*time.Hour))
	old := connOpenedAt(connWebSocket, "/ws/notifications", now.Add(-7*time.Hour))
	young := connOpenedAt(connWebSocket, "/ws/terminal", now.Add(-2*time.Hour))
	oldStream := connOpenedAt(connHTTP, "/api/host-only/box-link/stream", now.Add(-7*time.Hour))
	for _, c := range []*openConn{old, young, oldStream} {
		c.moved(2, false)
	}
	bk.addWS(&closeRecorder{}, old)
	bk.addWS(&closeRecorder{}, young)
	bk.openHTTP(oldStream)
	held := wt.heldBy(now, time.Hour, 6*time.Hour)
	if len(held) != 2 || held[0].Connection.Path != "/ws/notifications" || held[1].Connection.Path != "/api/host-only/box-link/stream" ||
		held[0].Reason != heldKeptAlive || held[1].Reason != heldKeptAlive || held[0].HeldAfterMs != (6*time.Hour).Milliseconds() {
		t.Fatalf("held = %+v, want the old WebSocket and the old stream, kept-alive", held)
	}
	if !strings.Contains(newBackendHeldEntry(held[0], 1, "x").Message, "by a kept-alive websocket") {
		t.Fatalf("message = %q", newBackendHeldEntry(held[0], 1, "x").Message)
	}
}

func TestHeldByIgnoresABackendInUseOrAlwaysOn(t *testing.T) {
	now := time.Now()
	used, bk := heldTestWorktree(t, "used", now.Add(-time.Minute))
	bk.openHTTP(connOpenedAt(connHTTP, "/api/slow", now.Add(-2*time.Hour)))
	if got := used.heldBy(now, time.Hour, 6*time.Hour); len(got) != 0 {
		t.Fatalf("a backend with a recent request is not held: %+v", got)
	}
	main, mbk := heldTestWorktree(t, mainNamespace, now.Add(-5*time.Hour))
	mbk.openHTTP(connOpenedAt(connHTTP, "/api/slow", now.Add(-2*time.Hour)))
	if got := main.heldBy(now, time.Hour, 6*time.Hour); len(got) != 0 {
		t.Fatalf("an always-on backend is never held: %+v", got)
	}
}

// A proxied request is listed while in flight, with what it is, and gone
// once it returns; its bytes are counted.
func TestConnectionsListsAnInFlightRequest(t *testing.T) {
	release := make(chan struct{})
	entered := make(chan struct{})
	pf := newProxyFixture(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/hang" {
			close(entered)
			<-release
		}
		_, _ = w.Write([]byte("ok"))
	})
	done := make(chan struct{})
	go func() {
		defer close(done)
		req := httptest.NewRequest(http.MethodPost, "http://"+pf.wt.Name+".localhost/api/hang?k=v", strings.NewReader("body!"))
		req.Header.Set("User-Agent", "probe/1")
		pf.proxy.ServeHTTP(httptest.NewRecorder(), req)
	}()
	<-entered

	list := getConnections(t, pf.proxy, "")
	if len(list) != 1 || list[0].Worktree != pf.wt.Name || len(list[0].Connections) != 1 {
		t.Fatalf("connections = %+v", list)
	}
	c := list[0].Connections[0]
	if c.Kind != connHTTP || c.Method != http.MethodPost || c.Path != "/api/hang" || c.UserAgent != "probe/1" || c.BytesIn != 5 || c.Principal == "" {
		t.Fatalf("connection = %+v", c)
	}
	close(release)
	<-done
	if list := getConnections(t, pf.proxy, pf.wt.Name); len(list) != 1 || len(list[0].Connections) != 0 {
		t.Fatalf("after the request returned: %+v", list)
	}
	if list := getConnections(t, pf.proxy, "nobody"); len(list) != 0 {
		t.Fatalf("?worktree= must narrow the list: %+v", list)
	}
}

func getConnections(t *testing.T, p *Proxy, worktree string) []BackendConnections {
	t.Helper()
	url := "http://localhost/gateway/connections"
	if worktree != "" {
		url += "?worktree=" + worktree
	}
	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, url, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /gateway/connections = %d %s", rec.Code, rec.Body.String())
	}
	var out []BackendConnections
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

type proxyFixture struct {
	proxy *Proxy
	wt    *Worktree
}

// newProxyFixture registers one worktree whose running backend is a real HTTP
// server on its socket, answering with handler.
func newProxyFixture(t *testing.T, handler http.HandlerFunc) proxyFixture {
	t.Helper()
	cfg := &Config{SocketsDir: shortTempDir(t), IdleTimeout: 10 * time.Minute, ChildEnv: testChildEnv(t)}
	reg := NewRegistry(cfg)
	wt, err := NewWorktree("alpha", &Spec{Server: "/tmp/server"}, cfg)
	if err != nil {
		t.Fatal(err)
	}
	reg.byName[wt.Name] = wt
	l, err := net.Listen("unix", wt.primarySocketPath())
	if err != nil {
		t.Fatal(err)
	}
	srv := &http.Server{Handler: handler}
	go func() { _ = srv.Serve(l) }()
	t.Cleanup(func() { _ = srv.Close() })
	cmd := exec.Command("sleep", "60")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill() })
	bk := &backend{proc: procOf(cmd), exitCh: make(chan struct{}), socketPath: wt.primarySocketPath(), proxy: newReverseProxy(wt.primarySocketPath())}
	go func() {
		_ = cmd.Wait()
		close(bk.exitCh)
	}()
	wt.mu.Lock()
	wt.phase = runningOn(bk)
	wt.mu.Unlock()
	routes := NewCentralRoutesStore(filepath.Join(t.TempDir(), "central-routes.json"))
	return proxyFixture{proxy: NewProxy(reg, routes, &Supervisor{}, "", newPanicReporter("", panicReportWindow)), wt: wt}
}
