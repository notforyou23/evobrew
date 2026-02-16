# Release Risk Exceptions

## XR-001: `xlsx` npm advisory (temporary exception)

- Date: 2026-02-16
- Severity: High (upstream advisory, no npm fix available)
- Package: `xlsx`
- Scope: Spreadsheet parsing/preview code paths

### Compensating controls (implemented)

- Internet profile blocks spreadsheet extraction endpoint usage:
  - `GET /api/extract-office-text` returns `403` for `.xlsx/.xls` in internet mode.
- Internet profile blocks spreadsheet preview endpoint usage:
  - `GET /api/preview-office-file` returns `403` for `.xlsx/.xls` in internet mode.
- Tool execution blocks spreadsheet parsing in internet mode:
  - `file_read` returns an error for spreadsheet parsing when internet restrictions are active.

### Release gate policy

- This exception is allowed only while spreadsheet parsing remains disabled for internet profile.
- Any additional high/critical production dependency vulnerability is a hard release blocker.
- Remove this exception after migrating away from `xlsx` or isolating spreadsheet parsing in a hardened sandbox.
