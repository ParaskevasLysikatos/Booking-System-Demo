from django.urls import path

from .views import PresignUploadView, UploadConfigView

urlpatterns = [
    path("config/", UploadConfigView.as_view(), name="upload-config"),
    path("presign/", PresignUploadView.as_view(), name="upload-presign"),
]
