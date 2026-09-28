from django.conf import settings
from django.core.mail import EmailMessage
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Send one test email through the configured EMAIL_PROVIDER (TICKET-030), e.g. to check Gmail API setup."

    def add_arguments(self, parser):
        parser.add_argument("to", help="Recipient address")

    def handle(self, *args, **options):
        message = EmailMessage(
            subject="Booking System Demo - test email",
            body=f"This is a test email sent with EMAIL_PROVIDER={settings.EMAIL_PROVIDER} "
                 f"(backend {settings.EMAIL_BACKEND}).",
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[options["to"]],
        )
        try:
            message.send(fail_silently=False)
        except Exception as exc:
            raise CommandError(f"Not sent: {exc}") from exc
        extra = getattr(message, "provider_message_id", "")
        self.stdout.write(self.style.SUCCESS(
            f"Sent to {options['to']} from {settings.DEFAULT_FROM_EMAIL} via {settings.EMAIL_PROVIDER}"
            + (f" (Gmail id {extra})" if extra else "") + "."))
