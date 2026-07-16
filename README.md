# Moonshiners YouTube Broadcast Workflow

## Files

- `.github/workflows/update-broadcasts.yml`
- `scripts/update-broadcasts.mjs`
- `data/broadcasts.json`

## Required GitHub secret

Create a repository Actions secret named:

`YOUTUBE_API_KEY`

Paste the Google Cloud API key as the secret value.

## Test

1. Commit these files to the repository's default branch.
2. Open the repository's **Actions** tab.
3. Select **Update Moonshiners Broadcasts**.
4. Click **Run workflow**.
5. Confirm `data/broadcasts.json` is updated and committed.

Keep the existing website integration active until this manual test succeeds.
