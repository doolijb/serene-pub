// Package control is the launcher's client for the control routes (§C3):
// GET /api/launcher/health and POST /api/launcher/shutdown, Bearer-token
// authenticated, loopback only, never proxied, never sending Origin.
package control

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/doolijb/serene-pub/launcher/internal/runtimefile"
)

// Health is the /api/launcher/health body.
type Health struct {
	Version   string `json:"version"`
	Ready     bool   `json:"ready"`
	State     string `json:"state"` // starting | ready | recovery | failed
	Pid       int    `json:"pid"`
	StartedAt string `json:"startedAt"`
	// FailedTasks names the startup tasks behind a "failed" state.
	FailedTasks []string `json:"failedTasks,omitempty"`
	// Clients is how many browser tabs/windows are connected; nil when the
	// server does not say (socket server not attached yet, or an older server).
	Clients *int `json:"clients,omitempty"`
}

// Health states.
const (
	StateStarting = "starting"
	StateReady    = "ready"
	StateRecovery = "recovery"
	// StateFailed: startup threw, or a task the instance cannot do without
	// failed. The app may still serve; it is not healthy.
	StateFailed = "failed"
)

// ErrRefused means the server answered 404 — wrong token, a non-loopback
// control URL, or a server without control routes (§C3 never says why).
var ErrRefused = errors.New("control route refused")

// Client talks to one server process.
type Client struct {
	BaseURL string
	Token   string
	HTTP    *http.Client
}

// New builds a client for rt with a transport that never uses a proxy.
func New(rt *runtimefile.Runtime) *Client {
	return &Client{
		BaseURL: strings.TrimRight(rt.ControlURL, "/"),
		Token:   rt.Token,
		HTTP: &http.Client{
			Timeout: 5 * time.Second,
			Transport: &http.Transport{
				Proxy:             nil, // a loopback control call must never leave the machine
				DialContext:       (&net.Dialer{Timeout: 2 * time.Second}).DialContext,
				DisableKeepAlives: true,
			},
			// Never follow a redirect with the token attached.
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}
}

func (c *Client) do(ctx context.Context, method, path string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Accept", "application/json")
	return c.HTTP.Do(req)
}

// Health fetches /api/launcher/health.
func (c *Client) Health(ctx context.Context) (Health, error) {
	var h Health
	resp, err := c.do(ctx, http.MethodGet, "/api/launcher/health")
	if err != nil {
		return h, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return h, ErrRefused
	}
	if resp.StatusCode != http.StatusOK {
		return h, fmt.Errorf("health: HTTP %d", resp.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&h); err != nil {
		return h, fmt.Errorf("health: %w", err)
	}
	return h, nil
}

// Shutdown asks the server to stop gracefully (202 expected).
func (c *Client) Shutdown(ctx context.Context) error {
	resp, err := c.do(ctx, http.MethodPost, "/api/launcher/shutdown")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<10))
	switch resp.StatusCode {
	case http.StatusAccepted, http.StatusOK:
		return nil
	case http.StatusNotFound:
		return ErrRefused
	}
	return fmt.Errorf("shutdown: HTTP %d", resp.StatusCode)
}

// Accepts reports whether something accepts TCP at addr (host:port).
func Accepts(addr string, timeout time.Duration) bool {
	conn, err := net.DialTimeout("tcp", addr, timeout)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}
