# Auth-service Templates

This directory is mounted into the auth-service container at `/templates`.

## Structure

```
templates/
├── default/          ← fallback pages used when no app-specific template exists
│   ├── login.html
│   ├── register.html
│   └── verify-email.html
└── <APP_SLUG>/       ← per-application overrides (e.g. "my-app")
    ├── login.html
    ├── register.html
    └── verify-email.html
```

## Template variables

The following placeholders are substituted at render time:

| Variable            | Description                                                           |
| ------------------- | --------------------------------------------------------------------- |
| `{{AUTH_URL}}`      | Public base URL of the auth-service (e.g. `https://auth.example.com`) |
| `{{REDIRECT_TO}}`   | URL-encoded destination after successful login                        |
| `{{APP_SLUG}}`      | Identifier of the OAuth application requesting the page               |
| `{{ERROR_MESSAGE}}` | Auth error string (empty string if no error)                          |

## Customisation

1. Copy the built-in default template from the auth-service image:

   ```bash
   docker run --rm --entrypoint cat ghcr.io/circle-rd/auth-service:latest \
     /app/templates/default/login.html > templates/default/login.html
   ```

2. Edit the file to match your brand.

3. Restart the auth-service container — templates are read from disk on every request,
   no rebuild needed.

## App-specific override example

To show a custom login page only when the OAuth app with slug `my-app` initiates the flow:

```
templates/my-app/login.html
```

Any page not found in `templates/my-app/` will fall back to `templates/default/`.
If `templates/default/` is empty the built-in templates shipped inside the Docker image
will be used automatically.
