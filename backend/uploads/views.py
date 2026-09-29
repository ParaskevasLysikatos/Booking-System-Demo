import logging

from django.conf import settings
from django.utils.translation import gettext as _, gettext_lazy
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from accounts.permissions import IsAdminRole

from . import s3

logger = logging.getLogger(__name__)


def _megabytes(n):
    mb = n / (1024 * 1024)
    return f"{mb:g} MB" if mb == int(mb) else f"{mb:.1f} MB"


class UploadConfigView(APIView):
    """GET /api/admin/uploads/config/ (TICKET-036) - admin only. Tells the
    Photos editor whether to show "Upload photos" and what the server will
    accept. No secrets: the keys never leave the server."""

    permission_classes = [IsAdminRole]

    def get(self, request):
        return Response({
            "enabled": s3.uploads_enabled(),
            "max_bytes": settings.UPLOADS_MAX_BYTES,
            "content_types": list(s3.CONTENT_TYPES),
        })


class PresignRequestSerializer(serializers.Serializer):
    content_type = serializers.ChoiceField(
        choices=list(s3.CONTENT_TYPES),
        error_messages={"invalid_choice": gettext_lazy("Only JPEG, PNG and WebP photos can be uploaded.")},
    )
    # The browser's own count of the (resized) file. Checked here only for a
    # friendly message - the real limit is S3's content-length-range.
    size = serializers.IntegerField(min_value=1)

    def validate_size(self, value):
        limit = settings.UPLOADS_MAX_BYTES
        if value > limit:
            raise serializers.ValidationError(_("Photos can be at most %(size)s.") % {"size": _megabytes(limit)})
        return value


class UploadThrottle(UserRateThrottle):
    """Per admin: a big batch of photos is fine, a runaway loop isn't."""

    scope = "uploads"
    rate = "120/min"


class PresignUploadView(APIView):
    """POST /api/admin/uploads/presign/ {content_type, size} (TICKET-036) -
    admin only. Returns a presigned S3 POST (url + form fields) for one new
    photo and the public URL it will have. 503 when uploads are off."""

    permission_classes = [IsAdminRole]
    throttle_classes = [UploadThrottle]

    def post(self, request):
        data = PresignRequestSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            upload = s3.presign(data.validated_data["content_type"])
        except s3.UploadsDisabled:
            return Response(
                {"detail": _("Photo uploads are switched off. Paste an image URL instead."),
                 "code": "uploads_disabled"},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except Exception:  # noqa: BLE001 - botocore errors; details go to the log only
            logger.exception("Could not presign an S3 upload")
            return Response(
                {"detail": _("Photo uploads aren't available right now. Try again, or paste an image URL."),
                 "code": "uploads_unavailable"},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        return Response(upload, status=status.HTTP_201_CREATED)
