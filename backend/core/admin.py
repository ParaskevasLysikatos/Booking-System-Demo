from django.contrib import admin

# `core` has no models of its own, so this is just where the admin site's
# global branding lives - a reminder (to anyone browsing at /admin/, or the
# code) that this is TICKET-010's dev-only DB inspection tool, not the
# demo-facing admin UI (that's the separate custom Angular app, Epic 4).
admin.site.site_header = "Booking System Demo — Dev DB Inspection"
admin.site.site_title = "Booking Demo Admin"
admin.site.index_title = "Development database inspection (not the demo-facing admin UI)"
