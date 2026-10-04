package version

import "testing"

func TestIsPrereleaseSharedVectors(t *testing.T) {
	cases := map[string]bool{
		"0.6.0":         false,
		"v0.6.0":        false,
		"0.6.0-beta":    false,
		"0.6.0-beta-2":  true,
		"0.6.0-rc-1":    true,
		"0.6.0-pr-1":    true,
		"0.6.0-dev":     true,
		"1.0.0+abc-def": false,
		"garbage":       true,
		"":              true,
		"dev":           true,
	}
	for in, want := range cases {
		if got := IsPrerelease(in); got != want {
			t.Errorf("IsPrerelease(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestValidTag(t *testing.T) {
	good := []string{"v0.6.1", "0.6.1", "v0.6.1-rc-1", "v1.2.3-beta"}
	bad := []string{"", "v0.6", "../v0.6.1", "v0.6.1/x", "v0.6.1-RC", "v0.6.1-rc.1", "v0.6.1 "}
	for _, s := range good {
		if !ValidTag(s) {
			t.Errorf("ValidTag(%q) = false", s)
		}
	}
	for _, s := range bad {
		if ValidTag(s) {
			t.Errorf("ValidTag(%q) = true", s)
		}
	}
}
