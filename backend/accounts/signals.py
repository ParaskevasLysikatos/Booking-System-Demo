from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Profile


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def create_profile_for_new_user(sender, instance, created, **kwargs):
    """Every user gets a Profile the moment they're created - via
    `createsuperuser`, the Django Admin "Add user" form, or (once
    TICKET-012 lands) the /api/auth/register/ endpoint - so `role` is never
    missing. A signal (rather than only `get_or_create` in the future
    register view) covers every one of those creation paths, not just one.

    Staff/superuser accounts default to the 'admin' app-role since they're
    administrative by definition; that's just the seeded value, not a
    binding - Profile.role can be changed independently at any time (e.g.
    from the admin dashboard later) without touching is_staff.
    """
    if created:
        Profile.objects.get_or_create(
            user=instance,
            defaults={
                "role": (
                    Profile.Role.ADMIN
                    if (instance.is_staff or instance.is_superuser)
                    else Profile.Role.GUEST
                ),
            },
        )
