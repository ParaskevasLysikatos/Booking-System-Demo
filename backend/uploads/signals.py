"""Deletes an uploaded photo from S3 once no property uses it any more
(TICKET-036 step 3).

Every way a PropertyImage row disappears goes through post_delete: the
admin form replacing a property's photo set (PropertyWriteSerializer
deletes and re-creates the rows), a photo removed in Django Admin, or a
property deleted there. Only this app's own uploads are touched
(s3.key_from_url), and only after the transaction commits - a rolled-back
save deletes nothing - and only if no row (on any property) still points at
the URL. That last check is what keeps the photos the admin *kept*: the
replace re-creates their rows in the same transaction.
"""
from django.db import transaction
from django.db.models.signals import post_delete
from django.dispatch import receiver

from listings.models import PropertyImage

from . import s3


def delete_if_unused(url):
    key = s3.key_from_url(url)
    if key is None or PropertyImage.objects.filter(image=url).exists():
        return False
    return s3.delete_object(key)


@receiver(post_delete, sender=PropertyImage, dispatch_uid="uploads_delete_unused_photo")
def photo_row_deleted(sender, instance, **kwargs):
    url = instance.image
    if s3.key_from_url(url) is not None:
        transaction.on_commit(lambda: delete_if_unused(url))
