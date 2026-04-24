# Tweakr Privacy Policy

**Last updated:** April 24, 2026

## Data Collection

Tweakr does **not** collect, transmit, or store any personal data. No analytics, tracking, or third-party services are used.

## How Tweakr Works

Tweakr is a developer tool that communicates exclusively with a local server running on your machine (`localhost`). All data stays on your computer.

- **Element information** (tag name, class names, text content) is sent to your local server to identify which source code element to modify.
- **Style changes** are sent to your local server to update CSS files in your project.
- No data is ever sent to external servers or the internet.

## Permissions Justification

| Permission | Why |
|------------|-----|
| `activeTab` | Required to inject the editing overlay into the page you're viewing |
| `scripting` | Required to inject the content script and CSS into web pages |
| `storage` | Stores your server host/port preferences (local only) |
| `host_permissions` (localhost) | Required to communicate with the local bridge server |

## Contact

For questions about this privacy policy, open an issue on the project's GitHub repository.
