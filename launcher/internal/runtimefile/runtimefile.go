// Package runtimefile reads <dataDir>/runtime.json (§C2), the rendezvous the
// production server writes once it is listening.
package runtimefile

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"regexp"
)

// Runtime is the §C2 document. Unknown keys are ignored.
type Runtime struct {
	Schema          int     `json:"schema"`
	Pid             int     `json:"pid"`
	Port            int     `json:"port"`
	Host            string  `json:"host"`
	ControlURL      string  `json:"controlUrl"`
	OpenURL         string  `json:"openUrl"`
	Version         string  `json:"version"`
	IsPrerelease    bool    `json:"isPrerelease"`
	Token           string  `json:"token"`
	StartedAt       string  `json:"startedAt"`
	DataDir         string  `json:"dataDir"`
	InstallRoot     *string `json:"installRoot"`
	LauncherVersion *string `json:"launcherVersion"`
	Channel         *string `json:"channel"`
}

var tokenRe = regexp.MustCompile(`^[0-9a-f]{64}$`)

// ErrInvalid wraps every reason a runtime file is not usable.
var ErrInvalid = errors.New("runtime.json invalid")

// Parse validates the fields the launcher depends on.
func Parse(data []byte) (*Runtime, error) {
	var rt Runtime
	if err := json.Unmarshal(data, &rt); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	if rt.Schema != 1 {
		return nil, fmt.Errorf("%w: schema %d", ErrInvalid, rt.Schema)
	}
	if rt.Pid <= 0 {
		return nil, fmt.Errorf("%w: pid %d", ErrInvalid, rt.Pid)
	}
	if rt.Port <= 0 || rt.Port > 65535 {
		return nil, fmt.Errorf("%w: port %d", ErrInvalid, rt.Port)
	}
	if !tokenRe.MatchString(rt.Token) {
		return nil, fmt.Errorf("%w: token", ErrInvalid)
	}
	for name, raw := range map[string]string{"controlUrl": rt.ControlURL, "openUrl": rt.OpenURL} {
		u, err := url.Parse(raw)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return nil, fmt.Errorf("%w: %s %q", ErrInvalid, name, raw)
		}
	}
	return &rt, nil
}

// Read loads and validates path. A missing file returns os.ErrNotExist.
func Read(path string) (*Runtime, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return Parse(data)
}

// ControlIsLoopback reports whether controlUrl names a loopback host — the
// only case in which the control routes can answer (§C2, §C3).
func (rt *Runtime) ControlIsLoopback() bool {
	u, err := url.Parse(rt.ControlURL)
	if err != nil {
		return false
	}
	switch u.Hostname() {
	case "127.0.0.1", "localhost", "::1":
		return true
	}
	return false
}

// ControlAddr is host:port of controlUrl, for a TCP accept probe.
func (rt *Runtime) ControlAddr() string {
	u, err := url.Parse(rt.ControlURL)
	if err != nil {
		return ""
	}
	return u.Host
}
