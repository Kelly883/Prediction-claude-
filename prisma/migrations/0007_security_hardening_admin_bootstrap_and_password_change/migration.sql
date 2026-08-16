-- Security hardening: removed public admin bootstrap pages and added password change endpoint
-- No schema changes required — existing fields (tokenVersion, UserSession, passwordResetTokens) already support these features.

-- 1. Removed public admin setup pages (app/admin/setup/page.tsx, app/admin-setup/page.tsx)
--    Admin bootstrap now requires ADMIN_BOOTSTRAP_SECRET via the API route only.

-- 2. Added PATCH /api/me/password endpoint for authenticated users to change their password.
--    This endpoint:
--    - Verifies currentPassword against stored hash
--    - Hashes newPassword with bcryptjs (cost factor 12)
--    - Increments tokenVersion to revoke all existing sessions
--    - Deletes all UserSession records for the user
--    - Writes audit log: auth.password_changed

-- 3. Added concurrent admin bootstrap race protection test
-- 4. Added payment reference uniqueness test
-- 5. Added password change endpoint tests
