from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('core.urls')),
    path('api/auth/', include('accounts.urls')),
    path('api/', include('listings.urls')),
    path('api/', include('bookings.urls')),
    path('api/payments/', include('payments.urls')),
]
