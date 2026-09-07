// Shared text only: this module may be imported by both Shell and GTK.
export function credentialStatus(code, _) {
    switch (code) {
    case 'keyring-locked': return _('Keyring locked — unlock in Access tokens');
    case 'token-missing': return _('Token missing — add it in Access tokens');
    case 'https-required': return _('Access tokens require HTTPS');
    case 'invalid-token': return _('Invalid token — replace it in Access tokens');
    default: return _('Keyring unavailable — check Preferences and Reconnect');
    }
}
