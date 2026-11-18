# Game Site

A browser-based game library for discovering and playing games.

## Project overview

This repository is the central place to store, back up, and track changes to the Game Site code.

**GitHub is used for code storage and version history. It is not the site's hosting platform.** The site is run using **Cloudflare** and **Google Apps Script**. Code is maintained in those platforms and copied or pasted into the relevant site files or platform editors as needed.

## Hosting and code workflow

The project uses three parts:

- **Cloudflare** — runs the Cloudflare-side code and services used by the site.
- **Google Apps Script** — runs the Apps Script-side code and services used by the site.
- **GitHub** — keeps the project's code in one central repository, provides a backup, and records changes over time.

The exact responsibilities of individual scripts and files depend on the current implementation. Keep Cloudflare code, Google Apps Script code, and frontend/site code separate; do not paste one type of code into the wrong platform.

### Making and saving an update

1. Make or receive the code change for the relevant part of the project.
2. Apply the Cloudflare changes in the appropriate Cloudflare editor or deployment workflow.
3. Apply the Google Apps Script changes in the appropriate Apps Script project, then save and deploy a new version if the change requires it.
4. Update the corresponding file(s) in this GitHub repository so the repository backup matches the working code.
5. Test the site and the affected features after the changes are applied.

If code is changed directly in Cloudflare or Google Apps Script, remember to copy the updated version back into GitHub. If code is changed in GitHub, copy it into the appropriate platform before expecting the live site to change. **A GitHub commit by itself does not publish the site.**

## Repository contents

Files in this repository may include:

- Frontend files such as HTML, CSS, and browser-side JavaScript
- Cloudflare-side code
- Google Apps Script code
- Supporting configuration, documentation, and assets

Check each file and its instructions before editing or deploying it. Keep platform-specific code in clearly named files where practical.

## Configuration and secrets

- Add environment variables and secrets in the platform that uses them (Cloudflare or Google Apps Script).
- Do not commit API keys, passwords, access tokens, private credentials, or other secrets to GitHub.
- If a secret is accidentally committed, remove it from the code and rotate/revoke the exposed credential; deleting it from the latest file alone may not remove it from Git history.

## Testing

After an update, check the parts affected by the change:

- The site loads without browser-console errors.
- Game browsing and game launching work.
- Any login, account, admin, or other backend features touched by the change work as expected.
- Cloudflare and Google Apps Script endpoints return the expected responses.
- The live deployment is using the latest saved/deployed code.

## Local files

You can clone the repository to inspect or edit its files:

```bash
git clone https://github.com/ppoopy1238-ux/game-site.git
cd game-site
```

Opening an HTML file locally may preview frontend-only parts, but it does not run Cloudflare services or Google Apps Script. Backend-dependent features must be tested against their deployed services.

## Contributing and maintenance

1. Make a focused change.
2. Test the affected feature.
3. Save the updated source in the appropriate platform.
4. Commit the matching code to GitHub with a clear commit message.
5. Record any required deployment steps or configuration changes in the relevant documentation.

## Issues and suggestions

For a bug or feature idea, include the affected page or feature, what you expected to happen, what actually happened, and any relevant error message. Do not include passwords, API keys, or other secrets in issues.

## Repository

[ppoopy1238-ux/game-site](https://github.com/ppoopy1238-ux/game-site)
