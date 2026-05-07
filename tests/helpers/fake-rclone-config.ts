/** Minimal `rclone config show`-style stdout for tests (Google Photos remote). */
export function fakeRcloneConfigShowGooglePhotos(
  clientId = "x.apps.googleusercontent.com",
): string {
  return `[gphotos]
type = google photos
token = {"access_token":"fake"}
client_id = ${clientId}
client_secret = GOCSPX-ignored
`;
}
