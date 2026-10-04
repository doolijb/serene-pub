package control

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/doolijb/serene-pub/launcher/internal/runtimefile"
)

const tok = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func TestClientSendsBearerAndNoOrigin(t *testing.T) {
	var shut bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+tok || r.Header.Get("Origin") != "" {
			w.WriteHeader(404)
			return
		}
		switch {
		case r.Method == "GET" && r.URL.Path == "/api/launcher/health":
			w.Write([]byte(`{"version":"0.6.1","ready":false,"state":"starting","pid":7,"startedAt":"x","extra":1}`))
		case r.Method == "POST" && r.URL.Path == "/api/launcher/shutdown":
			shut = true
			w.WriteHeader(202)
			w.Write([]byte(`{"ok":true}`))
		default:
			w.WriteHeader(404)
		}
	}))
	defer srv.Close()
	c := New(&runtimefile.Runtime{ControlURL: srv.URL, Token: tok})
	h, err := c.Health(context.Background())
	if err != nil || h.State != StateStarting || h.Pid != 7 || h.Ready {
		t.Fatalf("health %+v %v", h, err)
	}
	if err := c.Shutdown(context.Background()); err != nil || !shut {
		t.Fatalf("shutdown %v %v", err, shut)
	}
	c.Token = "wrong"
	if _, err := c.Health(context.Background()); err != ErrRefused {
		t.Fatalf("wrong token: %v", err)
	}
}

func TestHealthCarriesFailedTasksAndClients(t *testing.T) {
	bodies := map[string]string{
		"/new": `{"version":"0.6.1","ready":false,"state":"failed","pid":7,"startedAt":"x","failedTasks":["pipelines"],"clients":2}`,
		"/old": `{"version":"0.6.0","ready":true,"state":"ready","pid":7,"startedAt":"x"}`,
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(bodies[r.Header.Get("X-Case")]))
	}))
	defer srv.Close()
	get := func(which string) Health {
		c := New(&runtimefile.Runtime{ControlURL: srv.URL, Token: tok})
		c.HTTP.Transport = caseTransport{which}
		h, err := c.Health(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		return h
	}
	h := get("/new")
	if h.State != StateFailed || len(h.FailedTasks) != 1 || h.FailedTasks[0] != "pipelines" || h.Clients == nil || *h.Clients != 2 {
		t.Fatalf("new server: %+v", h)
	}
	// An older server says nothing about clients: unknown, not zero.
	if h := get("/old"); h.Clients != nil || h.State != StateReady {
		t.Fatalf("old server: %+v", h)
	}
}

type caseTransport struct{ which string }

func (c caseTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("X-Case", c.which)
	return http.DefaultTransport.RoundTrip(r)
}
