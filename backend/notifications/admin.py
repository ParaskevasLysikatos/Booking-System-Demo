from django.contrib import admin, messages

from .models import BookingEmail
from .outbox import send_email

Status = BookingEmail.Status


@admin.register(BookingEmail)
class BookingEmailAdmin(admin.ModelAdmin):
    """The email outbox (TICKET-030). Read-only - rows are written by the
    app - with one action: retry sending. On Render (no shell on the free
    plan) this is how a failed email is sent again; locally
    `manage.py send_pending_emails` does the same for all of them."""

    list_display = ("id", "booking", "kind", "reason", "status", "recipients", "attempts", "sent_at",
                    "last_error", "created_at")
    list_filter = ("status", "kind", "reason")
    search_fields = ("booking__id", "recipients", "provider_message_id")
    list_select_related = ("booking", "booking__property", "booking__guest")
    date_hierarchy = "created_at"
    actions = ["retry_sending"]
    readonly_fields = [f.name for f in BookingEmail._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False  # the outbox is the record of what was sent

    @admin.action(description="Retry sending the selected emails (never re-sends a sent one)")
    def retry_sending(self, request, queryset):
        counts = {}
        for pk in queryset.values_list("pk", flat=True):
            before = BookingEmail.objects.get(pk=pk).status
            after = send_email(pk).status  # never raises; sent/skipped rows are left alone
            key = "already sent" if before == Status.SENT else after
            counts[key] = counts.get(key, 0) + 1
        summary = ", ".join(f"{n} {label}" for label, n in sorted(counts.items()))
        level = messages.WARNING if counts.get(Status.FAILED) else messages.SUCCESS
        self.message_user(request, f"Emails: {summary}.", level)


class BookingEmailInline(admin.TabularInline):
    """The emails about one booking, on the Booking admin page."""

    model = BookingEmail
    extra = 0
    can_delete = False
    fields = ("kind", "reason", "status", "recipients", "attempts", "sent_at", "last_error")
    readonly_fields = fields
    show_change_link = True

    def has_add_permission(self, request, obj=None):
        return False
