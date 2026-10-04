package supervisor

import (
	"context"
	"os/exec"
	"time"
)

func ctxTimeout(d time.Duration) context.Context {
	ctx, cancel := context.WithTimeout(context.Background(), d)
	time.AfterFunc(d, cancel)
	return ctx
}

// codesign re-signs the macOS bundle ad hoc (§C8 step 5).
func codesign(bundle string) error {
	out, err := exec.Command("codesign", "--force", "--deep", "--sign", "-", bundle).CombinedOutput()
	if err != nil {
		return &codesignError{err: err, out: string(out)}
	}
	return nil
}

type codesignError struct {
	err error
	out string
}

func (e *codesignError) Error() string { return e.err.Error() + ": " + e.out }
