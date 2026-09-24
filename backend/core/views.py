from django.db import connection
from rest_framework.decorators import api_view
from rest_framework.response import Response


@api_view(['GET'])
def health_check(request):
    """Round-trips through Postgres so a green response proves all three
    pieces (Angular -> Django -> Postgres) are actually wired together,
    not just that each container happens to be running."""
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1')
            cursor.fetchone()
        database_status = 'connected'
    except Exception as exc:  # noqa: BLE001 - surface any DB error to the caller
        database_status = f'error: {exc}'

    return Response({
        'status': 'ok',
        'database': database_status,
    })
