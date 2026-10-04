package update

// applyAppImage is the reserved AppImage branch (§C8): an AppImage is a
// read-only squashfs, so a folder swap cannot work; its update is "replace the
// .AppImage file and re-exec", built in the AppImage phase. Until then it
// refuses and leaves the markers for Admin › Updates to discard.
func (m *Machine) applyAppImage() Result {
	m.logf("APPLY present on the appimage channel: unsupported in this build")
	m.c.Notify(Notice{Info, MsgUnsupported})
	return Result{Action: ActRefused}
}
