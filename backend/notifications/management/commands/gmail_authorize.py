"""One-time: get the Gmail API refresh token for sending booking emails.

    docker compose exec backend python manage.py gmail_authorize

Needs GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET (a "Desktop app" OAuth client in
Google Cloud) in .env. Prints a Google sign-in link; after signing in with
the Gmail account that should send the emails, the browser is sent to
http://127.0.0.1:8765/?code=... - a page that doesn't load, which is fine:
copy that whole address from the address bar and paste it here. The command
then prints GMAIL_REFRESH_TOKEN=... for .env and Render.

Only the `gmail.send` permission is asked for: the token can send email as
that account, nothing else (it can't read the mailbox). Uses PKCE and checks
the `state` value, so a pasted address from another sign-in is refused.
"""
import base64
import hashlib
import secrets
import urllib.parse

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from notifications.backends import AUTH_URL, SCOPE, TOKEN_URL, EmailSendError, post

REDIRECT_URI = "http://127.0.0.1:8765/"


class Command(BaseCommand):
    help = "Get the Gmail API refresh token (GMAIL_REFRESH_TOKEN) for sending booking emails (TICKET-030)."

    def add_arguments(self, parser):
        parser.add_argument("--redirected-url", help="The address the browser ended on (otherwise asked for).")

    def handle(self, *args, **options):
        client_id, client_secret = settings.GMAIL_CLIENT_ID, settings.GMAIL_CLIENT_SECRET
        if not (client_id and client_secret):
            raise CommandError("Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env first "
                               "(then `docker compose up -d backend` so the container picks them up).")

        verifier = secrets.token_urlsafe(64)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        state = secrets.token_urlsafe(16)
        url = AUTH_URL + "?" + urllib.parse.urlencode({
            "client_id": client_id,
            "redirect_uri": REDIRECT_URI,
            "response_type": "code",
            "scope": SCOPE,
            "access_type": "offline",  # -> a refresh token
            "prompt": "consent",  # always return a refresh token, even if authorised before
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        })
        self.stdout.write("1) Open this link and sign in with the Gmail account that should send the emails:\n")
        self.stdout.write(url + "\n")
        self.stdout.write("2) \"Google hasn't verified this app\" -> Advanced -> Go to ... (unsafe) -> Continue.")
        self.stdout.write("3) The browser ends on a page that doesn't load (127.0.0.1:8765/?code=...).")
        self.stdout.write("   Copy that whole address from the address bar and paste it here.\n")

        redirected = options["redirected_url"] or input("Address: ")
        query = urllib.parse.parse_qs(urllib.parse.urlparse(redirected.strip()).query)
        if "error" in query:
            raise CommandError(f"Google said: {query['error'][0]}")
        if query.get("state", [""])[0] != state:
            raise CommandError("That address doesn't belong to this sign-in (state mismatch) - run the command again.")
        code = query.get("code", [""])[0]
        if not code:
            raise CommandError("No ?code=... in that address.")

        try:
            answer = post(TOKEN_URL, timeout=settings.EMAIL_TIMEOUT, data={
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "code_verifier": verifier,
                "redirect_uri": REDIRECT_URI,
                "grant_type": "authorization_code",
            })
        except EmailSendError as exc:
            raise CommandError(str(exc)) from exc
        refresh_token = answer.get("refresh_token")
        if not refresh_token:
            raise CommandError("Google returned no refresh token - remove the app's access at "
                               "https://myaccount.google.com/permissions and run the command again.")
        if SCOPE not in answer.get("scope", SCOPE).split():
            raise CommandError("The gmail.send permission wasn't granted - tick it on Google's consent screen.")

        self.stdout.write(self.style.SUCCESS("\nDone. Put this line in .env and in Render (booking-demo-api -> Environment):\n"))
        self.stdout.write(f"GMAIL_REFRESH_TOKEN={refresh_token}\n")
        self.stdout.write("Keep it secret: it can send email as this account. Then try it with:\n"
                          "  docker compose exec backend python manage.py send_test_email you@example.com")
